import { test, expect } from '@playwright/test';
import { createProject } from '../../src/core/planner';
import { writeWord } from '../../src/core/word';

test('sample flows from script to storyboard and blocks incomplete export', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('从原剧本开始')).toBeVisible();
  await page.getByRole('button', { name: '打开样例' }).click();
  await expect(page.getByText('原剧本', { exact: true })).toBeVisible();
  await expect(page.locator('.segment-strip button').first()).toBeVisible();
  await expect(page.getByText('综合模式按剧情节拍逐段选文/武，不固定段数配比。')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出 TXT' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /本段问题/ })).toBeVisible();
  await page.getByRole('button', { name: '分镜预览' }).click();
  await expect(page.locator('.preview')).toContainText('① 人物参考图的描述');
  await expect(page.locator('.preview')).toContainText('⑭ 衔接');
  await page.getByLabel('导演意图').fill('她察觉信封异常');
  await expect(page.locator('.preview')).toContainText('她察觉信封异常');
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
});

test('one click runs the local chain: analysis, matching, ten generated fields', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.getByRole('button', { name: '一键生成' }).click();
  await expect(page.getByText(/本地规则导演已填充/)).toBeVisible();
  await expect(page.locator('.episode-bar')).toBeVisible();
  await page.getByRole('button', { name: '分镜预览' }).click();
  await expect(page.locator('.preview')).toContainText('③ 景别：过肩中景');
  await expect(page.locator('.preview')).toContainText('⑥ 运镜：');
  await expect(page.locator('.preview')).toContainText('⑭ 衔接：');
  await expect(page.getByRole('button', { name: /核对分集/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出 TXT' })).toBeDisabled();
});

test('batch import keeps every image and fills the segment after confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.route('**/api/vision', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'character', subject: '林夏', description: '黑色短发，白色衣领' }) }));
  await page.getByRole('button', { name: '接口设置' }).click();
  await page.getByLabel('接口地址').fill('https://example.test/v1/chat/completions');
  await page.getByLabel('模型').fill('vision');
  await page.getByLabel('接口密钥').fill('temporary-secret');
  await page.getByRole('button', { name: '关闭' }).click();
  const first = await page.screenshot({ clip: { x: 0, y: 0, width: 40, height: 40 } });
  const second = await page.screenshot({ clip: { x: 240, y: 320, width: 40, height: 40 } });
  await page.getByLabel('选择参考图片').setInputFiles([
    { name: '林夏_正面.png', mimeType: 'image/png', buffer: first },
    { name: '书房.png', mimeType: 'image/png', buffer: second },
  ]);
  await expect(page.getByText(/已入库 2 张/)).toBeVisible();
  await expect(page.locator('.image-item')).toHaveCount(2);
  await page.locator('.image-item').first().getByRole('checkbox').check();
  await page.locator('.image-item').first().getByRole('button', { name: 'AI 生成描述' }).click();
  await expect(page.getByLabel('林夏_正面.png描述')).toHaveValue('黑色短发，白色衣领');
  await page.locator('.image-item').first().getByRole('button', { name: '确认描述' }).click();
  await page.getByRole('button', { name: '分镜预览' }).click();
  await expect(page.locator('.preview')).toContainText('① 人物参考图的描述：黑色短发，白色衣领');
  await expect(page.getByRole('button', { name: 'Word' })).toBeDisabled();
});

test('imports Word text as a versioned source script', async ({ page }) => {
  const word = await writeWord(createProject('甲：Word 导入测试。', '导入样例'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入剧本' }).click();
  await (await chooser).setFiles({ name: '导入样例.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(word) });
  await expect(page.getByLabel('原剧本编辑区')).toContainText('Word 导入测试');
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
