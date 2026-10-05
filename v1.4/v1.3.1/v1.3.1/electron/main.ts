import { createRequire } from 'node:module';
import type * as Electron from 'electron';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describeImage } from './vision.js';
import { generateSegmentFields, testConnection } from './script.js';
import { buildMenuTemplate } from './menu.js';
import { decodeScriptBytes, normalizeScriptText, sniffScriptPayload } from './text.js';

// ESM 主进程下 `electron` 内置模块只保证通过 CJS require 解析，命名导入会被解析到 node_modules/electron。
const require = createRequire(import.meta.url);
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron') as typeof Electron;

/** 装载全中文应用菜单：只替换标签，role 沿用内置角色，行为与默认菜单一致。 */
function applyMenu() {
  const template = buildMenuTemplate(process.platform === 'darwin') as unknown as Electron.MenuItemConstructorOptions[];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
  applyMenu();
  ipcMain.handle('script:open', async () => {
    const choice = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '剧本与项目', extensions: ['txt', 'md', 'json', 'docx', 'doc', 'rtf'] }] });
    if (choice.canceled) return null;
    const path = choice.filePaths[0];
    const bytes = await readFile(path);
    // 扩展名不可信：伪装成 .txt 的 docx 必须按内容分流，否则会当纯文本解成乱码。
    const kind = sniffScriptPayload(bytes);
    return { path, kind, content: kind === 'docx' ? bytes.toString('base64') : normalizeScriptText(decodeScriptBytes(bytes)) };
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
