import { createRequire } from 'node:module';
import type * as Electron from 'electron';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describeImage } from './vision.js';
import { generateSegmentFields, testConnection } from './script.js';

// ESM 主进程下 `electron` 内置模块只保证通过 CJS require 解析，命名导入会被解析到 node_modules/electron。
const require = createRequire(import.meta.url);
const { app, BrowserWindow, dialog, ipcMain } = require('electron') as typeof Electron;

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temp, content, 'utf8');
  await rename(temp, path);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 980, minHeight: 650,
    webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  if (process.argv.includes('--dev')) window.loadURL('http://127.0.0.1:5173');
  else window.loadFile(join(import.meta.dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('script:open', async () => {
    const choice = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '剧本与项目', extensions: ['txt', 'md', 'json', 'docx'] }] });
    if (choice.canceled) return null;
    const path = choice.filePaths[0];
    return { path, content: path.toLowerCase().endsWith('.docx') ? (await readFile(path)).toString('base64') : await readFile(path, 'utf8') };
  });
  ipcMain.handle('project:save', async (_, content: string) => {
    const choice = await dialog.showSaveDialog({ defaultPath: '剧本项目.json', filters: [{ name: '项目快照', extensions: ['json'] }] });
    if (!choice.filePath) return null;
    await atomicWrite(choice.filePath, content);
    return choice.filePath;
  });
  ipcMain.handle('export:save', async (_, content: string) => {
    const choice = await dialog.showSaveDialog({ defaultPath: '分镜脚本.txt', filters: [{ name: '纯文本', extensions: ['txt'] }] });
    if (!choice.filePath) return null;
    await atomicWrite(choice.filePath, content);
    return choice.filePath;
  });
  ipcMain.handle('word:save', async (_, bytes: number[]) => {
    const choice = await dialog.showSaveDialog({ defaultPath: '分镜脚本.docx', filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
    if (!choice.filePath) return null;
    await mkdir(dirname(choice.filePath), { recursive: true });
    const temp = join(dirname(choice.filePath), `.${randomUUID()}.tmp`);
    await writeFile(temp, Buffer.from(bytes)); await rename(temp, choice.filePath);
    return choice.filePath;
  });
  ipcMain.handle('vision:describe', (_, request: unknown) => describeImage(request));
  ipcMain.handle('script:test', (_, request: unknown) => testConnection(request));
  ipcMain.handle('script:generate', (_, request: unknown) => generateSegmentFields(request));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
