import { z } from 'zod';

/** 生成通道只允许这 10 条；①②④⑫ 由既有链路注入，任何情况不得由模型改写。 */
const allowedKeys = ['scale', 'lens', 'movement', 'light', 'atmosphere', 'blocking', 'action', 'performance', 'sound', 'transition'] as const;

export const scriptRequestSchema = z.object({
  endpoint: z.url(), model: z.string().min(1), apiKey: z.string().min(1),
  segment: z.object({
    id: z.string(), mode: z.string(),
    shots: z.array(z.object({ id: z.string(), duration: z.number(), beatText: z.string(), dialogue: z.string() })).min(1),
  }),
  context: z.object({
    contentType: z.string(), mode: z.string(), characters: z.string(), scene: z.string(),
    imageDescriptions: z.array(z.string()).default([]),
    previousBlocking: z.string().default(''), previousLight: z.string().default(''), previousTransition: z.string().default(''),
  }),
});

/** strict：出现 ①②④⑫ 等受保护字段直接判为不合格输出，交由上层回退本地结果。 */
const shotFieldsSchema = z.object({
  shotId: z.string(),
  scale: z.string(), lens: z.string(), movement: z.string(), light: z.string(), atmosphere: z.string(),
  blocking: z.string(), action: z.string(), performance: z.string(), sound: z.string(), transition: z.string(),
}).strict();

const responseSchema = z.object({ shots: z.array(shotFieldsSchema).min(1) });

const systemPrompt = [
  '你是分镜导演助理。只输出 JSON，不要任何解释、前言或 Markdown 代码围栏。',
  `输出结构：{"shots":[{"shotId":"SC01",${allowedKeys.map((key) => `"${key}":"…"`).join(',')}}]}`,
  '规则：',
  '1. 只能输出上述 10 个字段，禁止输出人物参考图描述、场景参考图描述、构图、台词/内心OS；',
  '2. 台词与原稿一致，不得改写、增删；',
  '3. 衔接字段禁止使用：闪黑、闪白、黑场、白场、叠化、交叉溶解、淡入淡出、单纯推、单纯拉；',
  '4. 衔接须写明手段与匹配的具体元素（动作接动作、视线引导、遮挡转场、匹配剪辑、J-Cut/L-Cut、声音先入、空镜缓冲、同向运动顺接、光影变化接、焦点转移接）；',
  '5. 微表情须写到肌群级可执行动作，禁用「紧张地看着」这类情绪形容词；',
  '6. shots 数组必须与输入镜头一一对应，数量与 shotId 完全一致，全部字段不得为空字符串。',
].join('\n');

export type ScriptShotDraft = { shotId: string; fields: Record<string, string> };

/** 转场禁词表：口径与 ai-manhua-storyboard-qa / 本地闸门一致。 */
const forbiddenTransition = /闪黑|闪白|黑场|白场|叠化|交叉溶解|淡入淡出|单纯推|单纯拉/u;

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
  const endpoint = new URL(request.endpoint);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) throw new Error('文本接口必须使用 HTTPS 或本机地址');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify({
      model: request.model, temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ segment: request.segment, context: request.context }) },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`文本接口返回 ${response.status}`);
  const payload: unknown = await response.json();
  const content = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('文本接口未返回内容');
  const parsed = responseSchema.parse(extractJson(content));
  const expected = request.segment.shots.map((shot) => shot.id);
  const received = parsed.shots.map((shot) => shot.shotId);
  if (JSON.stringify(expected) !== JSON.stringify(received)) throw new Error('返回镜头与输入镜头不一致，已回退本地结果');
  return parsed.shots.map((shot) => {
    if (forbiddenTransition.test(shot.transition)) throw new Error(`文本模型返回的衔接命中转场禁词「${shot.transition}」，已回退本地结果`);
    const fields: Record<string, string> = {};
    for (const key of allowedKeys) fields[key] = shot[key];
    return { shotId: shot.shotId, fields };
  });
}

const connectionSchema = z.object({ endpoint: z.url(), model: z.string().optional(), apiKey: z.string().min(1) });

/** 测试连接：填完即可验证连通，不必等到生成时才发现错误。 */
export async function testConnection(input: unknown): Promise<{ ok: boolean; message: string }> {
  const request = connectionSchema.parse(input);
  const endpoint = new URL(request.endpoint);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) throw new Error('接口必须使用 HTTPS 或本机地址');
  const base = request.endpoint.replace(/\/chat\/completions\/?$/u, '').replace(/\/+$/u, '');
  try {
    const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${request.apiKey}` }, signal: AbortSignal.timeout(20000) });
    if (response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { data?: { id?: string }[] };
      const count = payload.data?.length;
      return { ok: true, message: count ? `连接成功，可用模型 ${count} 个` : '连接成功' };
    }
    return { ok: false, message: `接口返回 ${response.status}，请核对地址与密钥` };
  } catch (error) {
    return { ok: false, message: `连接失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
