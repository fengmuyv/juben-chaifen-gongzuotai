import { test, expect, _electron as electron, type TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import mammoth from 'mammoth';

/** 启动桌面端并隔离用户数据目录；外层环境可能注入 ELECTRON_RUN_AS_NODE，须剔除。 */
async function launchApp(testInfo: TestInfo, tag: string, extraArgs: string[] = []) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  const profile = testInfo.outputPath(tag);
  mkdirSync(profile, { recursive: true });
  return electron.launch({
    executablePath: join(process.cwd(), 'node_modules/electron/dist/electron.exe'),
    args: [process.cwd(), `--user-data-dir=${profile}`, ...extraArgs],
    env,
  });
}

test('desktop launches with isolated renderer', async ({}, testInfo) => {
  const app = await launchApp(testInfo, 'user-data');
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('从原剧本开始')).toBeVisible();
    expect(await page.evaluate(() => window.workbench && typeof window.workbench.open)).toBe('function');
    expect(await page.evaluate(() => 'require' in window)).toBe(false);
    /**
     * 桌面端仍持有本机密钥：界面可手填（手填只驻留内存、不进 localStorage），
     * 留空则回落本机私有配置；外部只拿得到布尔量状态。
     */
    expect(await page.evaluate(() => window.workbench && typeof window.workbench.credentials)).toBe('function');
    await page.getByRole('main').getByRole('button', { name: '接口设置' }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(1);
    await expect(page.getByLabel('本机密钥状态')).toBeVisible();
  } finally { await app.close(); }
});

test('应用菜单为全中文，无英文残留', async ({}, testInfo) => {
  const app = await launchApp(testInfo, 'user-data-menu');
  try {
    const topLabels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? []);
    expect(topLabels).toEqual(['文件', '编辑', '视图', '窗口']);

    const labels = await app.evaluate(({ Menu }) => {
      const collected: string[] = [];
      const walk = (items: import('electron').MenuItem[]): void => {
        for (const item of items) {
          if (item.type === 'separator') continue;
          if (item.label) collected.push(item.label);
          if (item.submenu) walk(item.submenu.items);
        }
      };
      const menu = Menu.getApplicationMenu();
      if (menu) walk(menu.items);
      return collected;
    });
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter((label) => /[A-Za-z]/.test(label))).toEqual([]);
  } finally { await app.close(); }
});

test('桌面窗口内一键生成不卡死并可导出前继续编辑', async ({}, testInfo) => {
  const app = await launchApp(testInfo, 'user-data-generate');
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByText('从原剧本开始')).toBeVisible();
    await page.getByRole('button', { name: '打开样例' }).click();
    await page.getByRole('button', { name: '一键生成' }).click();
    await expect(page.getByText(/本地规则导演已填充/)).toBeVisible({ timeout: 60000 });
    // 「成品与质检」面板已移除：生成结果直接在导演板卡片上读（反向锁死面板不回流）。
    await expect(page.locator('.result-pane')).toHaveCount(0);
    await expect(page.locator('.shot-card').first().getByLabel('景别')).not.toHaveValue('');
    // 生成后界面仍可响应：能继续人工修订正文条目。
    // P4 第二小步 b 起审阅台**整 P 铺开**（无镜页签），故直接定位第 2 张 SC 卡的 ⑪ 微表情。
    await page.locator('.shot-card').nth(1).getByLabel('微表情').fill('生成后仍可人工修订');
    await expect(page.locator('.shot-card').nth(1).getByLabel('微表情')).toHaveValue('生成后仍可人工修订');
    // 导出按钮始终可用。本集在自动修复后已无阻断，点击将走真实导出
    // （桌面端会弹系统保存对话框），故此处只验证可用性与界面无异常，避免在自动化中挂起原生对话框。
    await expect(page.locator('.toolbar').getByRole('button', { name: '导出 TXT' })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

/**
 * 白屏是最糟的失败形态：用户只看到「它坏了」，拿不到任何线索。
 * 用「开发模式 + 故意不启渲染层服务」制造真实的加载失败，验证兜底页确实出现且给出可照做的命令。
 */
test('界面加载失败时给出可照做的提示，而不是白屏', async ({}, testInfo) => {
  // --dev 会去加载 http://127.0.0.1:5173，而本测试刻意不启动该服务（e2e 的 dev server 在 5180）。
  const app = await launchApp(testInfo, 'user-data-fail', ['--dev']);
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('工作台界面加载失败')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('npm run build')).toBeVisible();
    await expect(page.getByText('ERR_CONNECTION_REFUSED', { exact: false })).toBeVisible();
  } finally { await app.close(); }
});

/**
 * 真实导出验收：这条链路是「用户点导出 → 文件真的落到磁盘」，也是此前
 * `nodebuffer is not supported by this platform` 报错所在的那条链路。
 * 之前的用例只断言到「按钮可用 / 弹出对话框」就停了，没验证过产物。
 *
 * 原生保存对话框自动化驱动不了，故在主进程内替换 `dialog.showSaveDialog` 为「直接返回固定路径」；
 * 其余链路（IPC `word:save` → 原子写临时文件 → rename）保持真实，落盘产物即真实产物。
 */
const exportDir = 'E:/wb_temp/wb-export-verify';

test('导出 Word 与 TXT 真实落盘，且 Word 能被解析回分镜正文', async ({}, testInfo) => {
  const app = await launchApp(testInfo, 'user-data-export');
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByText('从原剧本开始')).toBeVisible();

    mkdirSync(exportDir, { recursive: true });
    const wordPath = join(exportDir, '分镜脚本-验收.docx');
    const txtPath = join(exportDir, '分镜脚本-验收.txt');
    // 用例内**不得删除文件**：宿主的安全删除拦截按「轮次」累计计数，任何删除都可能被拦下，
    // 从而让用例变成依赖环境状态、不可重复。改为记录原有 mtime，用「时间戳变新」证明是本次写出的。
    const stamp = (path: string) => (existsSync(path) ? statSync(path).mtimeMs : 0);
    const wordBefore = stamp(wordPath);
    const txtBefore = stamp(txtPath);

    const stubSaveDialog = (target: string) => app.evaluate(({ dialog }, path) => {
      (dialog as unknown as { showSaveDialog: () => Promise<{ canceled: boolean; filePath: string }> }).showSaveDialog =
        async () => ({ canceled: false, filePath: path });
    }, target);

    await page.getByRole('button', { name: '打开样例' }).click();
    await page.getByRole('button', { name: '一键生成' }).click();
    await expect(page.getByText(/本地规则导演已填充/)).toBeVisible({ timeout: 60000 });

    // 1) Word：不只是「弹出对话框」，而是真的写出一个可被 Word 解析器读回正文的 .docx。
    await stubSaveDialog(wordPath);
    await page.locator('.toolbar').getByRole('button', { name: '导出 Word' }).click();
    await expect(page.getByText(/Word 已导出/)).toBeVisible({ timeout: 30000 });
    expect(existsSync(wordPath)).toBe(true);
    const bytes = readFileSync(wordPath);
    expect(stamp(wordPath)).toBeGreaterThan(wordBefore);
    expect(bytes.length).toBeGreaterThan(1000);
    // docx 本质是 ZIP 容器：魔数必须是 PK，否则是空壳或被写坏。
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    const text = (await mammoth.extractRawText({ buffer: bytes })).value;
    expect(text).toContain('分镜脚本');
    expect(text).toContain('景别');

    // 2) TXT：同一条保存链路，验证纯文本通道同样真实落盘且内容完整。
    await stubSaveDialog(txtPath);
    await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
    await expect(page.getByText(/TXT 分镜已导出/)).toBeVisible({ timeout: 30000 });
    const plain = readFileSync(txtPath, 'utf8');
    expect(stamp(txtPath)).toBeGreaterThan(txtBefore);
    expect(plain).toContain('分镜脚本');
    expect(plain).toContain('③ 景别');

    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
