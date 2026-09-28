import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('workbench', {
  open: () => ipcRenderer.invoke('script:open'),
  saveProject: (content: string) => ipcRenderer.invoke('project:save', content),
  saveExport: (content: string) => ipcRenderer.invoke('export:save', content),
});
