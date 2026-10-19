import { z } from 'zod';

const requestSchema = z.object({
  endpoint: z.url(), model: z.string().min(1), apiKey: z.string().min(1),
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
  const endpoint = new URL(request.endpoint);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) throw new Error('视觉接口必须使用 HTTPS 或本机地址');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify({ model: request.model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: buildPrompt(request.image.kind, request.candidates) }, { type: 'image_url', image_url: { url: request.image.dataUrl } }] }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`视觉接口返回 ${response.status}`);
  const payload: unknown = await response.json();
  const content = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('视觉接口未返回文字描述');
  const parsed = responseSchema.parse(extractJson(content));
  const kind = parsed.kind ?? request.image.kind;
  return { kind, subject: parsed.subject?.trim() ? parsed.subject.trim() : null, description: parsed.description.trim() };
}
