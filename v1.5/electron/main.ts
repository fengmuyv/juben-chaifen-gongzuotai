import { createRequire } from 'node:module';
import type * as Electron from 'electron';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describeImage } from './vision.js';
import { generateSegmentFields, testConnection } from './script.js';
import { credentialsStatus, saveLocalCredentials } from './credentials.js';
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

/**
 * 本机凭据的落点：**不再绑定 `process.cwd()`**。
 *
 * 成因：从不同目录启动 Electron（快捷方式、打包产物、CI）会让 `cwd` 漂移，出现
 * 「界面里保存过一次，重开就显示未配置」——写与读落在两个不同的目录上。
 * 改为锚定应用自身：开发态 = 应用根（工程目录，用户可见、可手工编辑）；
 * 打包态 = Electron 用户数据目录（asar 内不可写）。两者合成一条按序回退的查找链，
 * 历史上写在工程根的 `.env.local` 继续可用。
 */
function credentialsDirs(): string[] {
  const primary = app.isPackaged ? app.getPath('userData') : app.getAppPath();
  const fallback = process.cwd();
  return primary === fallback ? [primary] : [primary, fallback];
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
  /**
   * 界面只问「本机配好了没有」，拿到的是布尔量与公开字段 —— 密钥本体永不跨进程回传。
   * AI 调用所需密钥由主进程在发起请求时自行补齐。
   */
  ipcMain.handle('credentials:status', () => credentialsStatus(credentialsDirs()));
  /**
   * 把界面上填的密钥落到本机私有配置（`.env.local`）—— 界面上**没有保存按钮**，填写后自动进来。
   * 只接受这三个字符串字段，其余一律忽略；**空串是合法入参**，语义为「撤销本机密钥」。
   * 回执沿用 `credentialsStatus()` —— 依旧是布尔量，不回传密钥。
   */
  ipcMain.handle('credentials:save', (_, request: unknown) => {
    const payload = (request ?? {}) as { apiKey?: unknown; endpoint?: unknown; model?: unknown };
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);
    // 字段缺失 = 非法调用；**空串 ≠ 缺失**，它是「撤销」这一合法动作。
    if (typeof payload.apiKey !== 'string') throw new Error('密钥写入缺少 apiKey 字段');
    const apiKey = payload.apiKey.trim();
    return saveLocalCredentials(
      { apiKey: apiKey || undefined, endpoint: text(payload.endpoint) || undefined, model: text(payload.model) || undefined },
      credentialsDirs(),
    );
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
