import { test, expect } from '@playwright/test';

test('sample flows from script to storyboard and blocks incomplete export', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('从原剧本开始')).toBeVisible();
  await page.getByRole('button', { name: '打开样例' }).click();
  await expect(page.getByText('原剧本', { exact: true })).toBeVisible();
  await expect(page.locator('.segment-strip button').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '导出分镜' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /本段问题/ })).toBeVisible();
  await page.getByRole('button', { name: '分镜预览' }).click();
  await expect(page.locator('.preview')).toContainText('① 人物参考图的描述');
  await expect(page.locator('.preview')).toContainText('⑭ 衔接');
  await page.getByLabel('导演意图').fill('她察觉信封异常');
  await expect(page.locator('.preview')).toContainText('她察觉信封异常');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
});

test('mobile layout keeps controls usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await expect(page.getByLabel('人物固定锚点')).toBeVisible();
  await expect(page.getByRole('button', { name: /本段问题/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('switching project does not carry unsaved script text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.getByLabel('原剧本编辑区').fill('未保存的临时文字');
  await page.getByRole('button', { name: '样例', exact: true }).click();
  await expect(page.getByLabel('原剧本编辑区')).toContainText('第一场');
  await expect(page.getByLabel('原剧本编辑区')).not.toContainText('未保存的临时文字');
});
