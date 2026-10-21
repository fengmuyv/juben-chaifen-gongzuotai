import type { ReferenceImage } from './model';

/**
 * 接口目标：只保留「地址 + 密钥 + 思考强度」。
 * **厂商由主进程按地址自动识别**（见 `electron/ai-providers.ts` 的 `providerFromURL`），
 * 界面不再要求用户指名厂商；密钥可在界面手填（只存内存、不落盘），
 * 留空时由主进程用本机私有配置补齐。
 */
export type AiTarget = { endpoint?: string; apiKey?: string; effort?: 'off' | 'low' | 'medium' | 'high' };

export type VisionResult = { kind: ReferenceImage['kind']; subject: string | null; description: string };
export type VisionRequest = AiTarget & {
  model: string;
  image: Pick<ReferenceImage, 'kind' | 'dataUrl'>;
  candidates?: { characters: string[]; scenes: string[] };
};

export type ConnectionRequest = AiTarget & { model?: string };
/** `models` = 该密钥可见的模型列表，接入成功后供界面直接渲染下拉框。 */
export type ConnectionResult = { ok: boolean; message: string; models?: string[] };
/** 本机密钥配置状态：`configured` 是密钥在界面上的唯一可见形态（布尔量）。 */
export type CredentialsStatus = { configured: boolean; endpoint?: string; model?: string };

export type ScriptRequest = AiTarget & {
  model: string;
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

/** 查询本机是否已配置密钥。浏览器预览没有主进程，按未配置处理。 */
export async function requestCredentialsStatus(): Promise<CredentialsStatus> {
  if (window.workbench) return window.workbench.credentials();
  return { configured: false };
}

/**
 * 把界面填的密钥保存到本机私有配置（桌面版 `.env.local`）。
 * 浏览器预览没有主进程可写，直接给出可照做的提示；回执仍是「不含密钥」的状态。
 */
export async function requestSaveCredentials(request: { apiKey: string; endpoint?: string; model?: string }): Promise<CredentialsStatus> {
  if (window.workbench) return window.workbench.saveCredentials(request);
  throw new Error('浏览器预览没有本机配置可写；请在桌面版使用，或手工在工程目录的 .env.local 设置 WORKBENCH_API_KEY');
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
