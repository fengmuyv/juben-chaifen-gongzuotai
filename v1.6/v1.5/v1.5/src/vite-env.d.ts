/// <reference types="vite/client" />

/**
 * 本机接口默认值，由 .env.local 注入；未配置时为空串。
 * 注意：**只放非敏感项** —— `VITE_` 前缀会被打进浏览器构建产物，
 * 故密钥不走这里（用无前缀的 `WORKBENCH_API_KEY`，只由主进程读取）。
 */
interface ImportMetaEnv {
  readonly VITE_WORKBENCH_API_ENDPOINT?: string;
  readonly VITE_WORKBENCH_API_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  workbench?: {
    open(): Promise<{ path: string; kind: 'docx' | 'text'; content: string } | null>;
    saveProject(content: string): Promise<string | null>;
    saveExport(content: string): Promise<string | null>;
    saveWord(bytes: number[]): Promise<string | null>;
    describe(request: import('./core/vision').VisionRequest): Promise<import('./core/vision').VisionResult>;
    testConnection(request: import('./core/vision').ConnectionRequest): Promise<import('./core/vision').ConnectionResult>;
    generateSegment(request: import('./core/vision').ScriptRequest): Promise<import('./core/vision').ScriptShotDraft[]>;
    /** 只回本机密钥是否已配置，不回传密钥本体。 */
    credentials(): Promise<import('./core/vision').CredentialsStatus>;
    /** 把界面填的密钥写进本机私有配置；回执同样不含密钥。 */
    saveCredentials(request: { apiKey: string; endpoint?: string; model?: string }): Promise<import('./core/vision').CredentialsStatus>;
  };
}
