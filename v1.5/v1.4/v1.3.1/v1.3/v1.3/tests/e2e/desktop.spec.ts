import { test, expect, _electron as electron, type TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/** 启动桌面端并隔离用户数据目录；外层环境可能注入 ELECTRON_RUN_AS_NODE，须剔除。 */
async function launchApp(testInfo: TestInfo, tag: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  const profile = testInfo.outputPath(tag);
  mkdirSync(profile, { recursive: true });
  return electron.launch({
    executablePath: join(process.cwd(), 'node_modules/electron/dist/electron.exe'),
    args: [process.cwd(), `--user-data-dir=${profile}`],
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
    await page.getByRole('button', { name: '分镜预览' }).click();
    await expect(page.locator('.preview')).toContainText('③ 景别：');
    // 生成后界面仍可响应：能继续切镜并人工修订正文条目。
    await page.locator('.shot-tabs button').nth(1).click();
    await page.getByLabel('微表情').fill('生成后仍可人工修订');
    await expect(page.locator('.preview')).toContainText('生成后仍可人工修订');
    // 导出按钮不因阻断项失效：点击给出全书阻断清单。
    await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
    await expect(page.getByRole('dialog', { name: '全书阻断清单' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
