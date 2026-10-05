import { z } from 'zod';
import { generate } from './ai-client.js';
import { loadLocalCredentials, requireLocalApiKey } from './credentials.js';

/**
 * 视觉理解通道：多模态图片描述。
 *
 * 两处默认值都来自本机私有配置（`electron/credentials.ts`）：地址与密钥都可由调用方留空，
 * 此时由主进程补齐 —— 因此密钥不必经过界面，也不会出现在渲染层。
 * 协议差异（鉴权头 / 图片编码 / 推理字段）全部收敛在 `ai-client.ts`，此处只管提示词与结果契约。
 */

const requestSchema = z.object({
  /** 接口地址（到 /v1 一级；粘完整路径会被自动截断）。留空用本机配置默认值。 */
  endpoint: z.url().optional(),
  effort: z.enum(['off', 'low', 'medium', 'high']).optional(),
  /** 密钥；留空用本机私有配置。界面不再提供该项。 */
  apiKey: z.string().optional(),
  model: z.string().min(1),
  image: z.object({ kind: z.enum(['character', 'scene', 'prop']), dataUrl: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(3_000_000) }),
  candidates: z.object({ characters: z.array(z.string()), scenes: z.array(z.string()) }).optional(),
});

export type VisionResult = { kind: 'character' | 'scene' | 'prop'; subject: string | null; description: string };

const baseRules = [
  '只输出 JSON，不要解释、不要 Markdown 代码围栏。',
  '输出结构：{"kind":"character|scene|prop","subject":"…或 null","description":"…"}',
  'kind 只能从 character / scene / prop 三者中选一个。',
  'subject 只能从严给定的候选名单中原样选择，名单中没有就返回 null，禁止自行编造。',
  'description 只描述可见事实，不猜测身份、性格、情绪、武器或画外事实，不提图片编号。',
];

const kindRules: Record<'character' | 'scene' | 'prop', string> = {
  character: 'description 只写人物固定外观：面部辨识特征、发型、体型、服装、配饰。',
  scene: 'description 只写场景固定结构：门窗、家具相对方位、层次、材质、固定光源；看不清方位时不要推断。',
  prop: 'description 只写道具固定外形、颜色、材质与可辨痕迹。',
};

function buildPrompt(kind: 'character' | 'scene' | 'prop', candidates?: { characters: string[]; scenes: string[] }): string {
  const roster = [
    candidates?.characters.length ? `人物候选名单：${candidates.characters.join('、')}` : '人物候选名单：无',
    candidates?.scenes.length ? `场景候选名单：${candidates.scenes.join('、')}` : '场景候选名单：无',
  ].join('\n');
  return [baseRules.join('\n'), kindRules[kind], roster].join('\n');
}

function extractJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(content);
  const text = (fenced ? fenced[1] : content).trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('视觉接口未返回 JSON');
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('视觉接口返回的 JSON 无法解析'); }
}

const responseSchema = z.object({
  kind: z.enum(['character', 'scene', 'prop']).optional(),
  subject: z.string().nullable().optional(),
  description: z.string().min(1),
});

export async function describeImage(input: unknown): Promise<VisionResult> {
  const request = requestSchema.parse(input);
  const local = loadLocalCredentials();
  const content = await generate({
    baseURL: request.endpoint?.trim() || local.endpoint || '',
    apiKey: request.apiKey?.trim() || requireLocalApiKey(),
    model: request.model,
    effort: request.effort,
    text: buildPrompt(request.image.kind, request.candidates),
    images: [request.image.dataUrl],
    timeoutMs: 60_000,
  });
  if (!content) throw new Error('视觉接口未返回文字描述');
  const parsed = responseSchema.parse(extractJson(content));
  const kind = parsed.kind ?? request.image.kind;
  return { kind, subject: parsed.subject?.trim() ? parsed.subject.trim() : null, description: parsed.description.trim() };
}
