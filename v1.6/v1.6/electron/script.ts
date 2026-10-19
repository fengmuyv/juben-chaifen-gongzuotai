import { z } from 'zod';
import { generate, listModels } from './ai-client.js';
import { loadLocalCredentials, requireLocalApiKey } from './credentials.js';
import { forbiddenTransition } from './prompt.js';
import { mainFeed } from './skills/feeds.js';

/**
 * 再导出：本模块**对外签名一字不变**，禁词表与提示词的正本已收拢到 `prompt.ts`（P2）。
 * 收拢前 `allowedKeys` / `forbiddenTransition` / `systemPrompt` 三份常量都住在本文件，
 * 其中禁词表还与渲染层 `skill-default.ts` 双写 —— 现在主进程侧只剩一份。
 */
export { forbiddenTransition };

export const scriptRequestSchema = z.object({
  /** 接口地址（到 /v1 一级）。留空用本机配置默认值；协议由地址自动识别，无需指名厂商。 */
  endpoint: z.url().optional(),
  effort: z.enum(['off', 'low', 'medium', 'high']).optional(),
  /** 密钥；留空用本机私有配置。界面不再提供该项。 */
  apiKey: z.string().optional(),
  model: z.string().min(1),
  segment: z.object({
    id: z.string(), mode: z.string(),
    shots: z.array(z.object({ id: z.string(), duration: z.number(), beatText: z.string(), dialogue: z.string() })).min(1),
  }),
  context: z.object({
    contentType: z.string(), mode: z.string(), characters: z.string(), scene: z.string(),
    imageDescriptions: z.array(z.string()).default([]),
    previousBlocking: z.string().default(''), previousLight: z.string().default(''), previousTransition: z.string().default(''),
    /**
     * P3 起随请求带来的**不截断上下文**（§4.2 第 5/6 项）：
     * 本集原文、人物名册、弧光位置、上段完整结果。主进程只做透传与基本形状校验，
     * 不在这里裁剪 —— 裁剪点越多，模型看到的图景就越碎。
     */
    script: z.string().default(''),
    cast: z.array(z.string()).default([]),
    arc: z.string().default(''),
    previousShots: z.array(z.object({ shotId: z.string(), fields: z.record(z.string(), z.string()) })).default([]),
  }),
});

/** strict：出现 ①②④⑫ 等受保护字段直接判为不合格输出，交由上层回退本地结果。 */
const shotFieldsSchema = z.object({
  shotId: z.string(), composition: z.string(),
  scale: z.string(), lens: z.string(), movement: z.string(), light: z.string(), atmosphere: z.string(),
  blocking: z.string(), action: z.string(), performance: z.string(), sound: z.string(), transition: z.string(),
}).strict();

const responseSchema = z.object({ shots: z.array(shotFieldsSchema).min(1) });

export type ScriptShotDraft = { shotId: string; fields: Record<string, string> };

function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(content);
  const text = (fenced ? fenced[1] : content).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('文本模型未返回 JSON');
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('文本模型返回的 JSON 无法解析'); }
}

export async function generateSegmentFields(input: unknown): Promise<ScriptShotDraft[]> {
  const request = scriptRequestSchema.parse(input);
  const local = loadLocalCredentials();
  /**
   * 生效判据取自 skill 包（`./skills/feeds`），读不到包时回落 `prompt.ts` 的内置表。
   * 一次调用取一次：同批请求内禁词表与提示词必须同源，不得中途切换。
   */
  const feed = mainFeed();
  const content = await generate({
    baseURL: request.endpoint?.trim() || local.endpoint || '',
    apiKey: request.apiKey?.trim() || requireLocalApiKey(),
    model: request.model,
    effort: request.effort,
    system: feed.systemPrompt,
    text: JSON.stringify({ segment: request.segment, context: request.context }),
    timeoutMs: 120_000,
  });
  if (!content) throw new Error('文本接口未返回内容');
  const parsed = responseSchema.parse(extractJson(content));
  const expected = request.segment.shots.map((shot) => shot.id);
  const received = parsed.shots.map((shot) => shot.shotId);
  if (JSON.stringify(expected) !== JSON.stringify(received)) throw new Error('返回镜头与输入镜头不一致，已回退本地结果');
  return parsed.shots.map((shot) => {
    if (feed.forbiddenPattern.test(shot.transition)) throw new Error(`文本模型返回的衔接命中转场禁词「${shot.transition}」，已回退本地结果`);
    const fields: Record<string, string> = {};
    for (const key of feed.allowedKeys) fields[key] = shot[key];
    return { shotId: shot.shotId, fields };
  });
}

const connectionSchema = z.object({
  endpoint: z.url().optional(),
  model: z.string().optional(),
  /** 密钥；留空用本机私有配置。 */
  apiKey: z.string().optional(),
});

/**
 * 接入 + 探活：一个密钥拉出该密钥可见的模型列表 —— 即「接入后可选模型」的数据源。
 * models 直接供界面渲染下拉框；接入失败只回一句脱敏文案，绝不回显密钥。
 */
export async function testConnection(input: unknown): Promise<{ ok: boolean; message: string; models?: string[] }> {
  const request = connectionSchema.parse(input);
  const local = loadLocalCredentials();
  try {
    const models = await listModels({
      baseURL: request.endpoint?.trim() || local.endpoint || '',
      apiKey: request.apiKey?.trim() || requireLocalApiKey(),
    });
    return models.length
      ? { ok: true, message: `接入成功，可用模型 ${models.length} 个`, models }
      : { ok: true, message: '接入成功，但该密钥未返回模型列表' };
  } catch (error) {
    return { ok: false, message: `接入失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
