import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

test('desktop launches with isolated renderer', async ({}, testInfo) => {
  // 外层环境可能注入 ELECTRON_RUN_AS_NODE，使 Electron 退化为纯 Node 模式而无法建窗。
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  const profile = testInfo.outputPath('user-data');
  mkdirSync(profile, { recursive: true });
  const app = await electron.launch({
    executablePath: join(process.cwd(), 'node_modules/electron/dist/electron.exe'),
    args: [process.cwd(), `--user-data-dir=${profile}`],
    env,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('从原剧本开始')).toBeVisible();
    expect(await page.evaluate(() => window.workbench && typeof window.workbench.open)).toBe('function');
    expect(await page.evaluate(() => 'require' in window)).toBe(false);
  } finally { await app.close(); }
});
