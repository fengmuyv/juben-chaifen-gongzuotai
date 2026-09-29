import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('workbench', {
  open: () => ipcRenderer.invoke('script:open'),
  saveProject: (content: string) => ipcRenderer.invoke('project:save', content),
  saveExport: (content: string) => ipcRenderer.invoke('export:save', content),
  saveWord: (bytes: number[]) => ipcRenderer.invoke('word:save', bytes),
  describe: (request: unknown) => ipcRenderer.invoke('vision:describe', request),
});
