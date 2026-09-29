import { z } from 'zod';

const requestSchema = z.object({
  endpoint: z.url(), model: z.string().min(1), apiKey: z.string().min(1),
  image: z.object({ kind: z.enum(['character', 'scene', 'prop']), dataUrl: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(3_000_000) }),
});
const prompts = {
  character: '只描述图片中可见的人物固定外观：面部辨识特征、发型、体型、服装、配饰。不要猜测身份、性格、情绪、武器或画外事实。用简洁中文完整句输出，不提图片编号。',
  scene: '只描述图片中可见的场景固定结构：门窗、家具相对方位、层次、材质、固定光源。看不清方位时不要推断。用简洁中文完整句输出，不提图片编号。',
  prop: '只描述图片中可见的道具固定外形、颜色、材质与可辨痕迹。不要猜测功能、持有人或画外事实。用简洁中文完整句输出，不提图片编号。',
};

export async function describeImage(input: unknown): Promise<string> {
  const request = requestSchema.parse(input);
  const endpoint = new URL(request.endpoint);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) throw new Error('视觉接口必须使用 HTTPS 或本机地址');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify({ model: request.model, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompts[request.image.kind] }, { type: 'image_url', image_url: { url: request.image.dataUrl } }] }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`视觉接口返回 ${response.status}`);
  const payload: unknown = await response.json();
  const content = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('视觉接口未返回文字描述');
  return content.trim();
}
