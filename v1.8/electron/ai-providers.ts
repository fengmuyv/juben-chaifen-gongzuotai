/**
 * 通用模型厂商注册表（工作台唯一来源）
 *
 * 覆盖面 = 市面上主流通用语言大模型。事实标准：除 Anthropic 走 Messages 协议外，
 * 其余厂商（含全部国产）都提供 OpenAI 兼容端点，因此适配层只需两张协议实现，
 * 「新增一家厂商」= 在下方表里加一行，不动任何调用代码。
 *
 * **调用方不需要指名厂商**：`providerFromURL()` 按接口地址的 host 自动认领预设，
 * 认不出的地址（各类第三方中转）一律回落到 `custom`，按 OpenAI 兼容协议处理。
 *
 * 保密前提：本文件只描述公开的端点与参数约定，**不含任何密钥**。
 */

export type Protocol = 'openai' | 'anthropic';

/** 推理强度：统一四档，按协议映射到各家原生参数；off = 不发送该参数（默认，最安全）。 */
export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high';

export const reasoningLevels: ReasoningLevel[] = ['off', 'low', 'medium', 'high'];

export const reasoningLabels: Record<ReasoningLevel, string> = {
  off: '自动（不指定）',
  low: '低',
  medium: '中',
  high: '高',
};

export type ProviderPreset = {
  id: string;
  label: string;
  protocol: Protocol;
  /** 基址（OpenAI 兼容到 /v1 为止）。自定义厂商留空，由用户填。 */
  baseURL: string;
  /** 模型列表路径（相对基址）。 */
  modelsPath: string;
  /** 是否接受推理强度参数；false 时不发送，避免服务端 400。 */
  reasoning: boolean;
  /** 密钥申请入口。 */
  consoleURL?: string;
  /** 需要用户自填端点的厂商（本地 / 私有化 / 未公开端点）。 */
  requiresBaseURL?: boolean;
};

export const providerPresets: ProviderPreset[] = [
  // ── 国际 ──
  { id: 'openai', label: 'OpenAI（GPT）', protocol: 'openai', baseURL: 'https://api.openai.com/v1', modelsPath: '/models', reasoning: true, consoleURL: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic（Claude / Opus）', protocol: 'anthropic', baseURL: 'https://api.anthropic.com/v1', modelsPath: '/models', reasoning: true, consoleURL: 'https://console.anthropic.com/settings/keys' },
  { id: 'google', label: 'Google（Gemini）', protocol: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', modelsPath: '/models', reasoning: false, consoleURL: 'https://aistudio.google.com/apikey' },
  { id: 'xai', label: 'xAI（Grok）', protocol: 'openai', baseURL: 'https://api.x.ai/v1', modelsPath: '/models', reasoning: true, consoleURL: 'https://console.x.ai' },
  { id: 'mistral', label: 'Mistral', protocol: 'openai', baseURL: 'https://api.mistral.ai/v1', modelsPath: '/models', reasoning: false, consoleURL: 'https://console.mistral.ai/api-keys' },
  { id: 'groq', label: 'Groq', protocol: 'openai', baseURL: 'https://api.groq.com/openai/v1', modelsPath: '/models', reasoning: false, consoleURL: 'https://console.groq.com/keys' },

  // ── 国产 ──
  { id: 'deepseek', label: 'DeepSeek', protocol: 'openai', baseURL: 'https://api.deepseek.com/v1', modelsPath: '/models', reasoning: true, consoleURL: 'https://platform.deepseek.com/api_keys' },
  { id: 'kimi', label: '月之暗面 Kimi', protocol: 'openai', baseURL: 'https://api.moonshot.cn/v1', modelsPath: '/models', reasoning: false, consoleURL: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'glm', label: '智谱 GLM', protocol: 'openai', baseURL: 'https://open.bigmodel.cn/api/paas/v4', modelsPath: '/models', reasoning: true, consoleURL: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'qwen', label: '阿里通义千问', protocol: 'openai', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelsPath: '/models', reasoning: false, consoleURL: 'https://bailian.console.aliyun.com' },
  { id: 'doubao', label: '字节豆包（火山方舟）', protocol: 'openai', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', modelsPath: '/models', reasoning: false, consoleURL: 'https://console.volcengine.com/ark' },
  { id: 'hunyuan', label: '腾讯混元', protocol: 'openai', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1', modelsPath: '/models', reasoning: false, consoleURL: 'https://console.cloud.tencent.com/hunyuan/api-key' },
  { id: 'ernie', label: '百度文心', protocol: 'openai', baseURL: 'https://qianfan.baidubce.com/v2', modelsPath: '/models', reasoning: false, consoleURL: 'https://console.bce.baidu.com/iam/#/iam/apikey/list' },
  { id: 'minimax', label: 'MiniMax', protocol: 'openai', baseURL: 'https://api.minimax.chat/v1', modelsPath: '/models', reasoning: false },
  { id: 'spark', label: '讯飞星火', protocol: 'openai', baseURL: 'https://spark-api-open.xf-yun.com/v1', modelsPath: '/models', reasoning: false },
  { id: 'stepfun', label: '阶跃星辰', protocol: 'openai', baseURL: 'https://api.stepfun.com/v1', modelsPath: '/models', reasoning: false },
  { id: 'yi', label: '零一万物 Yi', protocol: 'openai', baseURL: 'https://api.lingyiwanwu.com/v1', modelsPath: '/models', reasoning: false },
  { id: 'baichuan', label: '百川智能', protocol: 'openai', baseURL: 'https://api.baichuan-ai.com/v1', modelsPath: '/models', reasoning: false },
  /** 小米 MiMo 尚无公开稳定的开放平台端点，先按「自填端点」处理，端点公布后在此补 baseURL 即可。 */
  { id: 'mimo', label: '小米 MiMo（需自填端点）', protocol: 'openai', baseURL: '', modelsPath: '/models', reasoning: false, requiresBaseURL: true },

  // ── 聚合 / 本地 / 自定义 ──
  { id: 'openrouter', label: 'OpenRouter（一个 key 通吃多家）', protocol: 'openai', baseURL: 'https://openrouter.ai/api/v1', modelsPath: '/models', reasoning: true, consoleURL: 'https://openrouter.ai/keys' },
  { id: 'siliconflow', label: '硅基流动 SiliconFlow', protocol: 'openai', baseURL: 'https://api.siliconflow.cn/v1', modelsPath: '/models', reasoning: false, consoleURL: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'ollama', label: 'Ollama（本机）', protocol: 'openai', baseURL: 'http://127.0.0.1:11434/v1', modelsPath: '/models', reasoning: false },
  { id: 'lmstudio', label: 'LM Studio（本机）', protocol: 'openai', baseURL: 'http://127.0.0.1:1234/v1', modelsPath: '/models', reasoning: false },
  /**
   * 兜底档：认不出 host 的地址（第三方中转、自建网关、私有化部署）都走这里。
   * 中转普遍是 OpenAI 兼容的，故协议按 openai 处理；`reasoning: true` 表示**允许**下发
   * `reasoning_effort`，但默认强度为 `off`（不发该字段），只有用户显式选择时才发送 ——
   * 这样既不会因参数不被识别而 400，又保留了开启思考的通道。
   */
  { id: 'custom', label: '自定义（OpenAI 兼容）', protocol: 'openai', baseURL: '', modelsPath: '/models', reasoning: true, requiresBaseURL: true },
];

export function presetOf(id: string): ProviderPreset {
  const found = providerPresets.find((preset) => preset.id === id);
  if (!found) throw new Error(`未知厂商：${id}`);
  return found;
}

/** 把用户填的地址归一为基址：允许粘贴完整路径，自动截到 /v1 一级。 */
export function normalizeBaseURL(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/u, '');
  return trimmed.replace(/\/(?:chat\/completions|completions|messages|responses|models|embeddings)$/u, '');
}

/**
 * 按接口地址自动认领厂商预设 —— 「厂商不必显示」的实现依据。
 * 命中注册表基址的 host 就用该预设（如 api.anthropic.com → Messages 协议）；
 * 认不出的地址（第三方中转、自建网关）回落到 `custom`，按 OpenAI 兼容协议处理。
 */
export function providerFromURL(baseURL: string): ProviderPreset {
  let host = '';
  try {
    host = new URL(normalizeBaseURL(baseURL)).hostname.toLowerCase();
  } catch {
    return presetOf('custom');
  }
  if (!host) return presetOf('custom');
  const matched = providerPresets.find((preset) => {
    if (!preset.baseURL) return false;
    try {
      return new URL(preset.baseURL).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  });
  return matched ?? presetOf('custom');
}

/** 解析出实际使用的基址；空地址直接报错，避免把请求发到一个空 host。 */
export function resolveBaseURL(baseURL?: string): string {
  const value = normalizeBaseURL(baseURL ?? '');
  if (!value) throw new Error('请填写接口地址（到 /v1 一级）');
  return value;
}

/**
 * 推理强度映射：只映射到明确支持的字段，未开启或该厂商不支持时返回空对象。
 * - Anthropic：thinking.budget_tokens（按其 Messages 协议要求，须配 max_tokens）
 * - OpenAI 兼容：reasoning_effort（近年模型普遍接受 low/medium/high）
 */
export function reasoningPayload(provider: string, level: ReasoningLevel, maxTokens: number): Record<string, unknown> {
  if (level === 'off') return {};
  const preset = presetOf(provider);
  if (!preset.reasoning) return {};
  if (preset.protocol === 'anthropic') {
    const share = { low: 0.2, medium: 0.5, high: 0.8 }[level];
    return { thinking: { type: 'enabled', budget_tokens: Math.max(1024, Math.round(maxTokens * share)) } };
  }
  return { reasoning_effort: level };
}
