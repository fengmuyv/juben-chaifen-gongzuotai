import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'node:path';

test('desktop launches with isolated renderer', async () => {
  const app = await electron.launch({ executablePath: join(process.cwd(), 'node_modules/electron/dist/electron.exe'), args: [process.cwd()] });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('从原剧本开始')).toBeVisible();
    expect(await page.evaluate(() => window.workbench && typeof window.workbench.open)).toBe('function');
    expect(await page.evaluate(() => 'require' in window)).toBe(false);
  } finally { await app.close(); }
});
