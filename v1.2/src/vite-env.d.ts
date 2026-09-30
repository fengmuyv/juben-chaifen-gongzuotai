/// <reference types="vite/client" />
interface Window {
  workbench?: {
    open(): Promise<{ path: string; content: string } | null>;
    saveProject(content: string): Promise<string | null>;
    saveExport(content: string): Promise<string | null>;
    saveWord(bytes: number[]): Promise<string | null>;
    describe(request: import('./core/vision').VisionRequest): Promise<import('./core/vision').VisionResult>;
    testConnection(request: import('./core/vision').ConnectionRequest): Promise<import('./core/vision').ConnectionResult>;
    generateSegment(request: import('./core/vision').ScriptRequest): Promise<import('./core/vision').ScriptShotDraft[]>;
  };
}
