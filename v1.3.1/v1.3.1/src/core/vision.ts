import type { ReferenceImage } from './model';

export type VisionResult = { kind: ReferenceImage['kind']; subject: string | null; description: string };
export type VisionRequest = {
  endpoint: string; model: string; apiKey: string;
  image: Pick<ReferenceImage, 'kind' | 'dataUrl'>;
  candidates?: { characters: string[]; scenes: string[] };
};

export type ConnectionRequest = { endpoint: string; model?: string; apiKey: string };
export type ConnectionResult = { ok: boolean; message: string };

export type ScriptRequest = {
  endpoint: string; model: string; apiKey: string;
  segment: { id: string; mode: string; shots: { id: string; duration: number; beatText: string; dialogue: string }[] };
  context: {
    contentType: string; mode: string; characters: string; scene: string;
    imageDescriptions: string[]; previousBlocking: string; previousLight: string; previousTransition: string;
  };
};
export type ScriptShotDraft = { shotId: string; fields: Record<string, string> };

/** 视觉增强通道（可选）：返回结构化 { kind, subject, description }。 */
export async function requestDescription(request: VisionRequest): Promise<VisionResult> {
  if (window.workbench) return window.workbench.describe(request);
  const response = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const result: Partial<VisionResult> & { error?: string } = await response.json();
  if (!response.ok || !result.description) throw new Error(result.error || '视觉描述失败');
  return { kind: result.kind ?? request.image.kind, subject: result.subject ?? null, description: result.description };
}

/** 测试连接：填完即可验证连通。 */
export async function requestConnectionTest(request: ConnectionRequest): Promise<ConnectionResult> {
  if (window.workbench) return window.workbench.testConnection(request);
  const response = await fetch('/api/script/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const result: ConnectionResult & { error?: string } = await response.json().catch(() => ({ ok: false, message: '响应无法解析' }));
  if (!response.ok) return { ok: false, message: result.error || result.message || '测试连接失败' };
  return result;
}

/** 文本增强通道（可选）：按段生成 10 条导演字段。 */
export async function requestSegmentFields(request: ScriptRequest): Promise<ScriptShotDraft[]> {
  if (window.workbench) return window.workbench.generateSegment(request);
  const response = await fetch('/api/script/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  const result: { shots?: ScriptShotDraft[]; error?: string } = await response.json();
  if (!response.ok || !result.shots) throw new Error(result.error || '文本生成失败');
  return result.shots;
}
