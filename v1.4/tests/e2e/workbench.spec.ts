import { test, expect } from '@playwright/test';
import { createProject } from '../../src/core/planner';
import { writeWord } from '../../src/core/word';

/**
 * 单场超长台词稿：单个段落台词长度超过 48 字硬上限。
 * 台词来自原稿，属事实类（input）问题——自动修复按原文重建、自动生成不回填台词，
 * 因此该阻断在「导出前自动修复 + 自动生成」之后必然存活，是闸门链路的稳定取景。
 */
const overLengthDialogue = `甲：${'这是一句用于验证输入类阻断在自动修复之后依然能够被跳转定位到具体段落上面的超长台词'.repeat(2)}`;

test('sample flows from script to storyboard and blocks unsafe export', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByText('从原剧本开始')).toBeVisible();
  await page.getByRole('button', { name: '打开样例' }).click();
  await expect(page.getByText('原剧本', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '输入图片' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '导演板' })).toBeVisible();
  await expect(page.locator('.input-image-pane')).toHaveCount(1);
  await expect(page.locator('.director-pane .image-settings')).toHaveCount(0);
  await expect(page.locator('.segment-strip button').first()).toBeVisible();
  await expect(page.getByText('综合模式按剧情节拍逐段选文/武，不固定段数配比。')).toBeVisible();
  // 导出按钮不因阻断项灰掉：仍可点击，由全书清单给出阻断项与跳转。
  await expect(page.locator('.toolbar').getByRole('button', { name: '导出 TXT' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /本段问题/ })).toBeVisible();
  await page.getByRole('button', { name: '分镜预览' }).click();
  await expect(page.locator('.preview')).toContainText('① 人物参考图的描述');
  await expect(page.locator('.preview')).toContainText('⑭ 衔接');
  await page.getByRole('button', { name: '一键生成' }).click();
  await expect(page.getByLabel('导演意图')).toHaveValue(/让观众/);
  await expect(page.getByLabel('导演意图')).toHaveAttribute('readonly', '');
  await expect(page.locator('.preview')).toContainText('让观众');
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  // 导出前会先自动修复结构、自动生成缺失字段：样例集随即无阻断 → 直接导出，不弹清单。
  // （渲染层与参考图描述未确认在 2026-09-30 编号裁定中已降为 warning，不再阻断导出。）
  await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
  await expect(page.getByText(/TXT 分镜已导出/).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: '全书阻断清单' })).toHaveCount(0);
  // 内容安全类问题不可自动修复：自动修复保留用户已填字段、自动生成不覆盖非空字段，
  // 故把 ⑭ 衔接改成转场禁词后导出必被阻断，清单给出条目、分类与跳转。
  await page.locator('.shot-tabs button').first().click();
  await page.getByLabel('衔接').fill('叠化');
  await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
  const gate = page.getByRole('dialog', { name: '全书阻断清单' });
  await expect(gate).toBeVisible();
  await expect(gate.locator('.gate-item').first()).toBeVisible();
  await expect(gate.getByText('内容安全').first()).toBeVisible();
  await gate.getByRole('button', { name: '跳转' }).first().click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByRole('button', { name: /本段问题/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
});

test('提醒位于左下角且关闭叉号独立在右上角', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.waitForTimeout(50);
  const toast = page.getByRole('status').filter({ has: page.getByRole('button', { name: '关闭提醒' }) });
  if (!(await toast.count())) return;
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  const closeBox = await toast.getByRole('button', { name: '关闭提醒' }).boundingBox();
  expect(box).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(closeBox!.x + closeBox!.width).toBeGreaterThan(box!.x + box!.width - 35);
  expect(closeBox!.y).toBeLessThan(box!.y + 16);
  await toast.getByRole('button', { name: '关闭提醒' }).click();
  await expect(toast).toHaveCount(0);
});

test('one click runs the local chain: analysis, matching, ten generated fields', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.getByRole('button', { name: '一键生成' }).click();
  await expect(page.getByText(/本地规则导演已填充/)).toBeVisible();
  await expect(page.getByRole('button', { name: '确认本段导演决定' })).toHaveCount(0);
  await expect(page.locator('.episode-bar')).toBeVisible();
  await page.getByRole('button', { name: '分镜预览' }).click();
  await expect(page.locator('.preview')).toContainText('③ 景别：过肩中景');
  await expect(page.locator('.preview')).toContainText('⑥ 运镜：');
  await expect(page.locator('.preview')).toContainText('⑭ 衔接：');
  await expect(page.getByRole('button', { name: /核对分集/ })).toBeVisible();
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  await expect(page.locator('.toolbar').getByRole('button', { name: '导出 TXT' })).toBeEnabled();
  // 浏览器环境导出 Word 必须成功：此前 Packer.toBuffer 会抛「nodebuffer is not supported by this platform」。
  const word = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: '导出 Word' }).click();
  await expect(page.getByText(/Word 分镜已导出/)).toBeVisible();
  expect((await word).suggestedFilename()).toContain('.docx');
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
  await expect(page.getByLabel(/描述/).first()).toContainText('林夏_正面；主色：');
  const palette = page.getByLabel('林夏_正面.png色卡').locator('span');
  await expect(palette.first()).toBeVisible();
  expect(await palette.count()).toBeLessThanOrEqual(8);
  await expect(page.getByText(/已入库 2 张/)).toBeVisible();
  await page.getByRole('button', { name: '清空描述' }).click();
  await expect(page.getByLabel('林夏_正面.png描述')).toHaveValue('');
  await expect(page.locator('.image-item')).toHaveCount(2);
  await page.locator('.image-item').first().getByRole('checkbox').check();
  await page.locator('.image-item').first().getByRole('button', { name: 'AI 生成描述' }).click();
  await expect(page.getByLabel('林夏_正面.png描述')).toHaveValue('黑色短发，白色衣领');
  await page.locator('.image-item').first().getByRole('button', { name: '确认描述' }).click();
  await page.getByRole('button', { name: '分镜预览' }).click();
  await expect(page.locator('.preview')).toContainText('① 人物参考图的描述：黑色短发，白色衣领');
  // 导出按钮不因阻断置灰：点击后先自动修复结构并生成缺失字段，本集随即无阻断 → 直接导出 Word。
  const word = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: '导出 Word' }).click();
  await expect(page.getByText(/Word 分镜已导出/).first()).toBeVisible();
  expect((await word).suggestedFilename()).toContain('.docx');
  await expect(page.getByRole('dialog', { name: '全书阻断清单' })).toHaveCount(0);
});

test('imports Word text as a versioned source script', async ({ page }) => {
  const word = await writeWord(createProject('甲：Word 导入测试。', '导入样例'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入剧本' }).click();
  await (await chooser).setFiles({ name: '导入样例.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(word) });
  await expect(page.getByLabel('原剧本编辑区')).toContainText('Word 导入测试');
});

test('imports a Word document renamed to .txt without mojibake', async ({ page }) => {
  const word = await writeWord(createProject('甲：伪装成 txt 的 Word 正文。', '伪装样例'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入剧本' }).click();
  // 扩展名是 .txt、内容却是 docx：按内容魔数分流，不得走文本解码兜底。
  await (await chooser).setFiles({ name: '倒查三代_定稿版剧本.txt', mimeType: 'text/plain', buffer: Buffer.from(word) });
  await expect(page.getByLabel('原剧本编辑区')).toContainText('伪装成 txt 的 Word 正文');
  const value = await page.getByLabel('原剧本编辑区').inputValue();
  expect(value).toContain('甲：伪装成 txt 的 Word 正文。');
  expect(value).not.toContain('\uFFFD');
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

test('已完成的一集可直接导出，未完成的集给出全书阻断清单并可跳转', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');

  // 1) 输入类阻断不可自动修复：单场台词超出 48 字硬上限（台词出自原稿，自动修复按原文重建、
  //    自动生成不回填台词，故阻断存活）。导出按钮仍可用，点击给出全书清单、分类、可忽略与跳转。
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入剧本' }).click();
  await (await chooser).setFiles({ name: '超长台词单场稿.txt', mimeType: 'text/plain', buffer: Buffer.from(`# 第一场 书房\n${overLengthDialogue}`) });
  await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
  const gate = page.getByRole('dialog', { name: '全书阻断清单' });
  await expect(gate).toBeVisible();
  await expect(gate.locator('.gate-item').first()).toBeVisible();
  await expect(gate.getByText('输入不完整').first()).toBeVisible();
  await expect(gate.getByRole('button', { name: '忽略可忽略阻断' })).toBeVisible();
  await gate.getByRole('button', { name: '忽略可忽略阻断' }).click();
  await expect(gate.locator('.gate-item')).toHaveCount(0);
  await gate.getByRole('button', { name: '恢复已忽略' }).click();
  await expect(gate.locator('.gate-item').first()).toBeVisible();
  await gate.getByRole('button', { name: '跳转' }).first().click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByRole('button', { name: /本段问题/ })).toBeVisible();

  // 2) 换成单集短稿并补全：确认视觉设定 → 一键生成 → 人工填写禁改的 ④构图。
  await page.getByLabel('原剧本编辑区').fill('# 第一场 书房\n甲：这封信你动过？\n乙：没有。');
  await page.getByRole('button', { name: '保存原稿版本' }).click();
  await page.getByRole('button', { name: '重新规划' }).click();
  await page.getByLabel('人物固定锚点').fill('甲：黑色齐肩直发，左眼下一颗小痣，穿深灰外套');
  await page.getByLabel('场景固定锚点').fill('书房入口在南侧，深色木书桌靠北墙，右侧窄窗引入冷色自然光');
  await page.getByRole('button', { name: '确认设定' }).click();
  await page.getByRole('button', { name: '一键生成' }).click();
  await expect(page.getByText(/本地规则导演已填充/).first()).toBeVisible({ timeout: 30000 });
  const shots = page.locator('.shot-tabs button');
  const shotCount = await shots.count();
  for (let index = 0; index < shotCount; index += 1) {
    await shots.nth(index).click();
    await page.getByLabel('构图').fill('门框占左前景，人物居中偏左，书桌位于右后景');
  }

  // 3) 本集无阻断 → 直接导出，且不再弹出清单。
  await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
  await expect(page.getByText(/TXT 分镜已导出/).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: '全书阻断清单' })).toHaveCount(0);
});

/** 合成整本体量剧本：52 集 × 3 场 × 8 行。 */
function buildBook(): string {
  const names = ['林夏', '陈默', '苏清苒', '顾南沉'];
  const lines: string[] = [];
  for (let episode = 1; episode <= 52; episode += 1) {
    lines.push(`第${episode}集 第${episode}夜`);
    for (let scene = 1; scene <= 3; scene += 1) {
      lines.push(`# 第${scene}场 书房${scene} · ${scene % 2 ? '白天' : '傍晚'}`);
      for (let row = 1; row <= 8; row += 1) {
        const who = names[(episode + row) % names.length];
        lines.push(row % 3 === 0
          ? `${who}按住桌面上的信封，右手指尖停在裂开的封蜡上，身体向门口方向侧转。`
          : `${who}：这封信第${episode}集${scene}场第${row}句，你动过没有，我要一个说法。`);
      }
    }
  }
  return lines.join('\n');
}

test('startup reads the draft once instead of polling it on every state change', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __idbOpen: number }).__idbOpen = 0;
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<typeof original>) {
      (window as unknown as { __idbOpen: number }).__idbOpen += 1;
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.waitForTimeout(2000);
  const opens = await page.evaluate(() => (window as unknown as { __idbOpen: number }).__idbOpen);
  expect(opens).toBeLessThan(30);
});

test('全部分集生成在整本工程上逐集回填，不漏集且不卡死', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await page.getByLabel('原剧本编辑区').fill(buildBook());
  await page.getByRole('button', { name: '保存原稿版本' }).click();
  await page.getByRole('button', { name: '重新规划' }).click();
  await expect(page.locator('.episode-list button')).toHaveCount(52);
  await page.getByRole('button', { name: '全部分集生成' }).click();
  await expect(page.getByText(/全部分集生成完成/).first()).toBeVisible({ timeout: 60000 });
  // 首集与末集都已标记，说明逐集回填没有中途丢集。
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  await page.locator('.episode-list button').nth(51).click();
  await expect(page.locator('.episode-list button').nth(51)).toHaveClass(/active/);
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  // 主线程未被占死：生成后仍可切集并编辑。
  await page.locator('.episode-list button').nth(1).click();
  await expect(page.locator('.segment-strip button').first()).toBeVisible();
  expect(errors).toEqual([]);
});
