/// <reference types="vite/client" />
interface Window {
  workbench?: {
    open(): Promise<{ path: string; content: string } | null>;
    saveProject(content: string): Promise<string | null>;
    saveExport(content: string): Promise<string | null>;
  };
}
