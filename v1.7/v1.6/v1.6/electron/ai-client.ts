import { providerFromURL, reasoningPayload, resolveBaseURL, type ReasoningLevel } from './ai-providers.js';

/**
 * 通用 API Key 接入层（工作台唯一入口）
 *
 * 一个密钥接多家：调用方只提供 { 接口地址, 密钥, 模型 }，**不必指名厂商** ——
 * 协议差异（OpenAI 兼容 / Anthropic Messages、鉴权头、图片编码、推理强度字段名）
 * 全部收敛在这个文件里，厂商由地址自动认领（`providerFromURL`）。
 *
 * 保密底线（改动本文件不得违反）：
 * 1. 密钥只以运行时入参在内存中短途传递 —— 不读 .env、不写文件、不进 localStorage、不进构建产物；
 * 2. 一切对外的错误文案先过 `redact()`，**绝不回显密钥、请求头**；
 * 3. 本模块不提供任何写盘 / 持久化接口，凭据随进程结束消失。
 */

export type AiCredentials = {
  /** 接口基址（只到 /v1 一级；粘了完整路径会被自动截断）。协议由地址自动识别。 */
  baseURL: string;
  apiKey: string;
};

export type GenerateInput = AiCredentials & {
  model: string;
  /** 系统提示词：OpenAI 协议并入 messages[0]，Anthropic 协议走顶层 system 字段。 */
  system?: string;
  /** 用户文字输入。 */
  text: string;
  /** 可选图片（dataURL，形如 `data:image/png;base64,...`），用于多模态理解。 */
  images?: string[];
  /** 推理强度；'off' 时不发送任何推理参数（默认，最安全）。 */
  effort?: ReasoningLevel;
  maxTokens?: number;
  timeoutMs?: number;
};

/** 兜底脱敏：即使服务端把请求原样回显，也不会把密钥带出去。 */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/gu, 'sk-***')
    .replace(/(x-api-key|api[-_]?key|authorization)["']?\s*[:=]\s*["']?[^"',\s}]+/giu, '$1=***');
}

/** 只允许 HTTPS 或本机回环：避免把密钥经明文通道发出去。 */
export function assertEndpointAllowed(baseURL: string, source: string): void {
  const url = new URL(baseURL);
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return;
  throw new Error(`${source}必须使用 HTTPS 或本机地址`);
}

function authHeaders(protocol: 'openai' | 'anthropic', apiKey: string): Record<string, string> {
  return protocol === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/** 把 dataURL 拆成 Anthropic 需要的 media_type + base64。 */
function splitDataURL(dataUrl: string): { mediaType: string; data: string } {
  const matched = /^data:(image\/[a-z+]+);base64,(.+)$/u.exec(dataUrl);
  if (!matched) throw new Error('图片格式不受支持，仅接受 base64 图片');
  return { mediaType: matched[1], data: matched[2] };
}

function timeoutOf(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** 错误归一：只带来源与状态码；服务端原因先脱敏再截断。 */
export async function describeAiError(response: Response, source: string): Promise<Error> {
  const raw = await response.text().catch(() => '');
  let reason = '';
  try {
    const parsed: unknown = JSON.parse(raw);
    const holder = parsed as { error?: { message?: unknown }; message?: unknown };
    const text = holder.error?.message ?? holder.message;
    if (typeof text === 'string') reason = text;
  } catch { reason = raw; }
  const tail = reason ? `：${redact(reason).slice(0, 200)}` : '';
  return new Error(`${source}返回 ${response.status}${tail}`);
}

/**
 * 网络层错误归一：**必须把最内层 `cause` 的判据带出来**（2026-10-06 修订）。
 *
 * 原写法只回传 `error.message`，而 undici（Node 的 fetch）在网络层失败时 message 恒为
 * `fetch failed`，真正有用的信息全在 `cause` 里 —— `UND_ERR_CONNECT_TIMEOUT`（连不通）、
 * `ENOTFOUND`（域名解析不了）、`CERT_HAS_EXPIRED`（证书）…… 全被丢掉之后，
 * 界面只能报一句「接口无法连接：fetch failed」，排查者无从判断是密钥、地址还是网络。
 * 老大 2026-10-06 报的「AI 推理与本地一模一样」，真因正是这条被吞掉的 cause
 * （本机连不上该中转域名 → 每段都抛错 → 整集回退本地）。
 *
 * 脱敏与长度仍然守住：先过 `redact()`，再截断 160 字。
 */
export function describeNetworkError(error: unknown, source: string): Error {
  if (timeoutOf(error)) return new Error(`${source}请求超时`);
  const cause = (error as { cause?: { code?: unknown; errno?: unknown; syscall?: unknown; hostname?: unknown; port?: unknown; message?: unknown } } | null)?.cause;
  const code = String(cause?.code ?? cause?.errno ?? '').trim();
  const host = String(cause?.hostname ?? '').trim();
  const target = host ? `（${host}${cause?.port ? `:${cause.port}` : ''}）` : '';
  const inner = typeof cause?.message === 'string' && cause.message.trim()
    ? cause.message
    : (error instanceof Error ? error.message : String(error));
  return new Error(`${source}无法连接${code ? `[${code}]` : ''}${target}：${redact(inner).slice(0, 160)}`);
}

/** 拉取该密钥可见的模型列表 —— 这是「接入后可选模型」的唯一数据来源。 */
export async function listModels(credentials: AiCredentials): Promise<string[]> {
  const base = resolveBaseURL(credentials.baseURL);
  const preset = providerFromURL(base);
  assertEndpointAllowed(base, '接口');
  let response: Response;
  try {
    response = await fetch(`${base}${preset.modelsPath}`, {
      headers: authHeaders(preset.protocol, credentials.apiKey),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) { throw describeNetworkError(error, '接口'); }
  if (!response.ok) throw await describeAiError(response, '接口');
  const payload: unknown = await response.json().catch(() => null);
  const rows = (payload as { data?: { id?: unknown }[] } | null)?.data ?? [];
  return rows.map((row) => String(row.id ?? '')).filter(Boolean).sort();
}

/**
 * 统一的生成入口：按厂商协议组装请求，返回纯文本。
 * 开启推理强度时不下发 temperature —— 推理类模型普遍拒绝自定义温度，会直接 400。
 */
export async function generate(input: GenerateInput): Promise<string> {
  const base = resolveBaseURL(input.baseURL);
  const preset = providerFromURL(base);
  assertEndpointAllowed(base, '接口');
  const effort = input.effort ?? 'off';
  const maxTokens = input.maxTokens ?? 8192;
  const images = input.images ?? [];

  let path = '/chat/completions';
  let body: Record<string, unknown>;
  if (preset.protocol === 'anthropic') {
    path = '/messages';
    body = {
      model: input.model,
      max_tokens: maxTokens,
      ...(input.system ? { system: input.system } : {}),
      messages: [{
        role: 'user',
        content: images.length
          ? [{ type: 'text', text: input.text }, ...images.map((url) => { const { mediaType, data } = splitDataURL(url); return { type: 'image', source: { type: 'base64', media_type: mediaType, data } }; })]
          : input.text,
      }],
      ...reasoningPayload(preset.id, effort, maxTokens),
    };
  } else {
    body = {
      model: input.model,
      messages: [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        {
          role: 'user',
          content: images.length
            ? [{ type: 'text', text: input.text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))]
            : input.text,
        },
      ],
      ...(effort === 'off' ? { temperature: 0 } : {}),
      ...reasoningPayload(preset.id, effort, maxTokens),
    };
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: authHeaders(preset.protocol, input.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
    });
  } catch (error) { throw describeNetworkError(error, '接口'); }
  if (!response.ok) throw await describeAiError(response, '接口');

  const payload: unknown = await response.json().catch(() => null);
  if (preset.protocol === 'anthropic') {
    const parts = (payload as { content?: { type?: string; text?: unknown }[] } | null)?.content ?? [];
    return parts.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('').trim();
  }
  const content = (payload as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}
