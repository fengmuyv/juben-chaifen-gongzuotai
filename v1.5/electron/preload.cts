import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('workbench', {
  open: () => ipcRenderer.invoke('script:open'),
  saveProject: (content: string) => ipcRenderer.invoke('project:save', content),
  saveExport: (content: string) => ipcRenderer.invoke('export:save', content),
  saveWord: (bytes: number[]) => ipcRenderer.invoke('word:save', bytes),
  describe: (request: unknown) => ipcRenderer.invoke('vision:describe', request),
  testConnection: (request: unknown) => ipcRenderer.invoke('script:test', request),
  generateSegment: (request: unknown) => ipcRenderer.invoke('script:generate', request),
  /** 只回「本机是否已配置密钥」与公开字段，**不回传密钥本体**。 */
  credentials: () => ipcRenderer.invoke('credentials:status'),
  /** 把界面填的密钥写进本机私有配置；回执同样是「不含密钥」的状态。 */
  saveCredentials: (request: { apiKey: string; endpoint?: string; model?: string }) => ipcRenderer.invoke('credentials:save', request),
});
