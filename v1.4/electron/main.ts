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

/**
 * 加载失败时的兜底页。
 *
 * 白屏对一个「打开就要能用」的工具是最糟的失败形态：用户看到的是「它坏了」，拿不到任何线索。
 * 最常见成因是渲染层产物尚未构建（`electron .` 加载 `dist/index.html`），所以兜底页直接给出构建命令。
 */
function failurePage(target: string, reason: string): string {
  const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>剧本拆分工作台 · 界面加载失败</title></head>
<body style="margin:0;font:16px/1.75 'Microsoft YaHei',sans-serif;background:#12161a;color:#e8eef2;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:640px;padding:32px">
<h1 style="font-size:20px;margin:0 0 14px">工作台界面加载失败</h1>
<p style="margin:0 0 6px">加载目标：<code>${escape(target)}</code></p>
<p style="margin:0 0 18px">失败原因：${escape(reason)}</p>
<p style="margin:0 0 6px">最常见的原因是渲染层产物尚未构建。请在工程目录执行：</p>
<pre style="background:#1c2228;padding:12px 14px;border-radius:6px;margin:0 0 18px">npm run build</pre>
<p style="margin:0;color:#9fb1bd">构建完成后重新打开本程序即可。</p>
</div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 980, minHeight: 650,
    webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  /** 任何加载失败都换成能看懂、能照做的兜底页；已加载的兜底页自身不再触发，避免死循环。 */
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || validatedURL.startsWith('data:')) return;
    void window.loadURL(failurePage(validatedURL || '(未知地址)', `${errorDescription}（错误码 ${errorCode}）`));
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    void window.loadURL(failurePage('渲染进程', `渲染进程已退出：${details.reason}`));
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
