import type { ReferenceImage } from './model';

export type VisionRequest = { endpoint: string; model: string; apiKey: string; image: Pick<ReferenceImage, 'kind' | 'dataUrl'> };

export async function requestDescription(request: VisionRequest): Promise<string> {
  if (window.workbench) return window.workbench.describe(request);
  const response = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const result: { description?: string; error?: string } = await response.json();
  if (!response.ok || !result.description) throw new Error(result.error || '视觉描述失败');
  return result.description;
}
