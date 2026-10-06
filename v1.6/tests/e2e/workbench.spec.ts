import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createProject } from '../../src/core/planner';
import { writeWord } from '../../src/core/word';

/**
 * 「真正可交互」的判据：主线程连续 `quietMs` 没有阻塞帧。
 *
 * e2e 里「等元素出现」只能证明 DOM 建好了 —— 参考图的 base64 解码与光栅化发生在节点出现**之后**，
 * 那段时间用户 hover 完全没有反应（老大 2026-10-04 反馈「鼠标放在按键上大概三秒后才有反应」）。
 * 只按「元素出现」计时会把读数截断在卡顿结束之前，低估真实成本。
 *
 * 判据用 `requestAnimationFrame` 的帧间隔：间隔 > 25ms 即视为主线程被占住，静默期重新计时；
 * 连续静默 `quietMs` 才算真的可交互。返回耗时毫秒；超时返回 -1。
 */
async function waitForMainThreadIdle(page: Page, quietMs: number, maxWait: number): Promise<number> {
  return page.evaluate(async ({ quietMs: value, maxWait: limit }) => {
    const started = performance.now();
    let last = started;
    let quietStart = started;
    return await new Promise<number>((resolve) => {
      const step = () => {
        const now = performance.now();
        const gap = now - last;
        last = now;
        if (gap > 25) quietStart = now;
        if (now - quietStart >= value) return resolve(Math.round(now - started));
        if (now - started >= limit) return resolve(-1);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { quietMs, maxWait });
}

/**
 * 展开左栏某个折叠段。
 *
 * P4 定稿（2026-10-06）把工作区收成两栏，左栏「输入与设定」四段**默认全部收起**，
 * 且段内容遵守「折叠即卸载」—— 收起态既不渲染 DOM 也不做整本解析。
 * 因此任何要碰段内元素的用例都必须**先展开**：在收起态取 `原剧本编辑区` 或资产下拉
 * 会稳定取到 0 个，报错信息还会指向「元素不存在」这种误导方向。
 *
 * 定位用 `data-section`（`Section` 组件写在段头按钮上）而不是无障碍名：
 * 左栏里含「资产」二字的按钮不止一个（两组各有「清空本类全部资产」），按名字取会命中多个。
 */
async function openSection(page: Page, name: string): Promise<void> {
  const head = page.locator(`.rail-section-head[data-section="${name}"]`);
  await expect(head).toBeVisible();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
}

/**
 * 长流程用例的显式预算。
 *
 * 这几条用例要先把「一本 52 集的密集稿」灌进 `<textarea>`（或注入一份 55MB 存档）再跑生成 / 重启，
 * 而**造稿这一步本身就值二十来秒**（Playwright 往 textarea 灌十几万字符，trace 实测单步 27s）。
 * Playwright 默认的 30s test timeout 与之不自洽 —— 它们内部早就写着 `timeout: 30000` 的 step 等待，
 * 作者本意就是「单步可能到 30s」。
 *
 * 余量实测（2026-10-06 · `-g "生成作业可暂停"` 单跑对照，同条件同 worker 数）：
 * P4 第二小步之前 **24.6s** 通过 / 本步 **25.4s** 通过 —— 差 0.8s 属正常波动，
 * **无性能回归**；但 30s 下只剩约 5s 余量，两个 worker 并行时即越线（整轮跑就撞在这儿）。
 *
 * 所以给足预算，让判据说清真实成本，而不是把「并行时的资源竞争」误报成功能失败。
 * **这不是放宽验收**：断言一条未减，只是不再让默认 timeout 切断长流程。
 */
const LONG_FLOW_MS = 120_000;

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
  // 左栏四段默认收起（P4 定稿）：要看段内容先展开。
  await openSection(page, '剧本原稿');
  await expect(page.getByText('原剧本', { exact: true })).toBeVisible();
  await openSection(page, '资产');
  await expect(page.getByRole('heading', { name: '输入图片' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '导演板' })).toBeVisible();
  await expect(page.locator('.input-image-pane')).toHaveCount(1);
  await expect(page.locator('.director-pane .image-settings')).toHaveCount(0);
  await expect(page.locator('.segment-strip button').first()).toBeVisible();
  // ★ 滚动定位（防回流）：刚打开就要看到 P 索引条与段头，而不是某张卡的中段 ——
  // 实测缺陷：卡片高 1104px / 可视区 585px 时，无条件的 scrollIntoView 会把索引条顶出视口（scrollTop 281）。
  expect(await page.locator('.director-pane').evaluate((node) => node.scrollTop)).toBe(0);
  // 审阅台**整 P 铺开**（P4 第二小步 b）：该 P 的全部 SC 一次铺开，每 SC 一卡、卡头即标题行。
  const cards = page.locator('.shot-card');
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toHaveAttribute('data-shot', /^SC\d+$/);
  await expect(cards.first().locator('.shot-card-title')).toContainText(/^SC\d+【.+｜\d+s】$/);
  await expect(cards.first().locator('.field-grid label')).toHaveCount(14);
  // 三个只读位与 `protectedKeys` 一一对应：①② 标「资产」、⑫ 标「原稿」（额外的一枚带 .source）。
  await expect(cards.first().locator('.origin-tag')).toHaveCount(3);
  await expect(cards.first().locator('.origin-tag.source')).toHaveCount(1);
  // 段头：「重新生成本 P」只作用于本段（不是整集）。
  await expect(page.getByRole('button', { name: '重新生成本 P' })).toBeVisible();
  await expect(page.getByText('综合模式按剧情节拍逐段选文/武，不固定段数配比。')).toBeVisible();
  // 导出按钮不因阻断项灰掉：仍可点击，由全书清单给出阻断项与跳转。
  await expect(page.locator('.toolbar').getByRole('button', { name: '导出 TXT' })).toBeEnabled();
  // 「成品与质检」面板已整体移除（2026-10-06 老大裁定「这块不要了」）：右栏只剩导演板。
  // 反向锁死 —— 面板本体、其页签条与整集预览都不得回流。
  await expect(page.locator('.result-pane')).toHaveCount(0);
  await expect(page.locator('.preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /本集校验/ })).toHaveCount(0);
  // 面板移除后，14 格的可读性由卡片承载：首格是 ① 只读位、末格是 ⑭ 衔接。
  await expect(cards.first().locator('.field-grid label').first()).toContainText('人物参考图的描述');
  await expect(cards.first().locator('.field-grid label').last()).toContainText('衔接');
  await page.getByRole('button', { name: '一键生成' }).click();
  // 导演意图不再有独立输入框：它是只读派生位，只出现在卡片头（与标题行同源）。
  await expect(page.locator('.shot-card-title').first()).toContainText(/让观众/);
  await expect(page.getByLabel('导演意图')).toHaveCount(0);
  // 面板移除后，生成结果只在卡片上可读：本段首卡的 ③ 景别已由规则导演写入。
  await expect(cards.first().getByLabel('景别')).not.toHaveValue('');
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  // 「重新生成本 P」：只重跑本段，未勾选「覆盖已有内容」时只补空白（故填充 0 条也不报错）。
  await page.getByRole('button', { name: '重新生成本 P' }).click();
  await expect(page.getByText(/已重新生成 P01/)).toBeVisible();
  // 导出前会先自动修复结构、自动生成缺失字段：样例集随即无阻断 → 直接导出，不弹清单。
  // （渲染层与参考图描述未确认在 2026-09-30 编号裁定中已降为 warning，不再阻断导出。）
  await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
  await expect(page.getByText(/TXT 分镜已导出/).first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: '全书阻断清单' })).toHaveCount(0);
  // 内容安全类问题不可自动修复：自动修复保留用户已填字段、自动生成不覆盖非空字段，
  // 故把 ⑭ 衔接改成转场禁词后导出必被阻断，清单给出条目、分类与跳转。
  // 整 P 铺开后同名输入框有多个（每镜一个），必须**限定到具体卡片**，否则选择器歧义。
  await page.locator('.shot-card').first().getByLabel('衔接').fill('叠化');
  await page.locator('.toolbar').getByRole('button', { name: '导出 TXT' }).click();
  const gate = page.getByRole('dialog', { name: '全书阻断清单' });
  await expect(gate).toBeVisible();
  await expect(gate.locator('.gate-item').first()).toBeVisible();
  await expect(gate.getByText('内容安全').first()).toBeVisible();
  await gate.getByRole('button', { name: '跳转' }).first().click();
  await expect(gate).toHaveCount(0);
  // 跳转把目标镜的卡片滚入视口并选中（原「本集校验」页签已随面板移除）。
  await expect(page.locator('.shot-card.selected')).toHaveCount(1);
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
  // 「成品与质检」面板已整体移除：生成结果直接在导演板卡片上读（反向锁死面板不回流）。
  await expect(page.locator('.result-pane')).toHaveCount(0);
  await expect(page.locator('.preview')).toHaveCount(0);
  const generatedCard = page.locator('.shot-card').first();
  const generatedValues = await page.locator('.shot-card textarea').evaluateAll((nodes) => nodes.map((node) => (node as HTMLTextAreaElement).value));
  // ③ 景别仍取规则表档位（与预览同一份 `gradeForShot`），故「过肩中景」必须真的落到某个镜上。
  expect(generatedValues).toContain('过肩中景');
  await expect(generatedCard.getByLabel('运镜')).not.toHaveValue('');
  await expect(generatedCard.getByLabel('衔接')).not.toHaveValue('');
  await expect(page.getByRole('button', { name: /核对分集/ })).toBeVisible();
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  await expect(page.locator('.toolbar').getByRole('button', { name: '导出 TXT' })).toBeEnabled();
  // 浏览器环境导出 Word 必须成功：此前 Packer.toBuffer 会抛「nodebuffer is not supported by this platform」。
  const word = page.waitForEvent('download');
  await page.locator('.toolbar').getByRole('button', { name: '导出 Word' }).click();
  await expect(page.getByText(/Word 分镜已导出/)).toBeVisible();
  expect((await word).suggestedFilename()).toContain('.docx');
});

/**
 * 片段导出（P ≡ 15 秒一段）：段头能只导当前那一片，Word / TXT 二选一。
 *
 * 本用例的**主断言不是「能下载」**，而是「导完不污染整集状态」——
 * 这正是本次刻意不接 `prepareForExport()` 的原因：那个函数会对整集跑一遍规则生成再回填，
 * 顺带把每一段都挂上「已生成」。用「先只重生 P01 → 导出 → 仍只有 1 个已生成标」把这条锁死：
 * 若有人图省事把片段导出接到 `exportTarget`，此断言立刻红。
 */
test('exports the current segment only, in Word or TXT, without touching the rest of the episode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  // 只重生本段：样例集其余段保持「未生成」，作为后面「未被污染」的基线。
  await page.getByRole('button', { name: '重新生成本 P' }).click();
  await expect(page.getByText(/已重新生成 P01/)).toBeVisible();
  await expect(page.locator('.segment-strip .gen-tag')).toHaveCount(1);

  // 段头新增控件：格式下拉 + 「导出当前片段」，与「重新生成本 P」同行。
  await expect(page.getByLabel('片段导出格式')).toBeVisible();
  const exportButton = page.getByRole('button', { name: '导出当前片段' });
  await expect(exportButton).toBeVisible();

  const word = page.waitForEvent('download');
  await exportButton.click();
  await expect(page.getByText(/P01 Word 片段已导出/)).toBeVisible();
  const filename = (await word).suggestedFilename();
  expect(filename).toContain('P01');
  expect(filename).toMatch(/\.docx$/);

  // 格式二选一：切 TXT 再导一次，后缀跟着变。
  await page.getByLabel('片段导出格式').selectOption('txt');
  const txt = page.waitForEvent('download');
  await exportButton.click();
  await expect(page.getByText(/P01 TXT 片段已导出/)).toBeVisible();
  expect((await txt).suggestedFilename()).toMatch(/\.txt$/);

  // 关键：两次片段导出之后，整集仍只有 P01 一个「已生成」标。
  await expect(page.locator('.segment-strip .gen-tag')).toHaveCount(1);
});

test('batch import keeps every image and the description takes effect without confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  // 资产段默认收起：隐藏的 file input 与两组「下拉 + 已选标签」都在段内，先展开。
  await openSection(page, '资产');
  await page.route('**/api/vision', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'character', subject: '林夏', description: '黑色短发，白色衣领' }) }));
  await page.getByRole('button', { name: '接口设置' }).click();
  await page.getByLabel('接口地址').fill('https://example.test/v1/chat/completions');
  // 模型项在 url 与 key 都就绪后才渲染：浏览器预览无本机密钥，先补一个占位密钥。
  await page.getByLabel('密钥', { exact: true }).fill('sk-e2e-placeholder');
  await page.getByLabel('模型').fill('vision');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const first = await page.screenshot({ clip: { x: 0, y: 0, width: 40, height: 40 } });
  const second = await page.screenshot({ clip: { x: 240, y: 320, width: 40, height: 40 } });
  await page.getByLabel('选择参考图片').setInputFiles([
    { name: '林夏_正面.png', mimeType: 'image/png', buffer: first },
    { name: '书房.png', mimeType: 'image/png', buffer: second },
  ]);
  // 导入**只入库**：描述与分析都不再自动跑（2026-10-05 老大裁定「人工点击按键补齐描述，不是自动」）。
  // 2026-10-06 起描述编辑区**一次只开一张**（选中项），刚导入时谁都没被选中，故一个描述框都不该存在。
  await expect(page.getByLabel('林夏_正面.png描述')).toHaveCount(0);
  await expect(page.getByText(/已入库 2 张/)).toBeVisible();
  // 资产区 = **两类各一组「下拉 + 已选标签」**（2026-10-06 老大原话：「把左边的输入图片改为下拉选择
  // 人物，场景；道具选区不要了」）。这推翻了同日早些时候的三框并列 —— 判据随之翻成「恰两组」+「道具组不存在」。
  // 直接给隐藏 input 塞文件时落到**人物**组（缺省导入目标）。
  await expect(page.locator('.asset-picker')).toHaveCount(2);
  await expect(page.getByLabel('道具资产')).toHaveCount(0);
  await expect(page.getByLabel('人物资产').locator('select option')).toHaveCount(3);
  await expect(page.getByLabel('场景资产')).toContainText('暂无场景资产');
  await expect(page.getByRole('menu', { name: '资产分类' })).toHaveCount(0);
  // 人工点人物组的「一键补充描述」才生成描述，并**顺带**落库图像分析（色卡与图类理由随之出现）。
  // 组内四键只作用于**本组**（此处场景组始终为空，不被牵连）。
  await page.getByLabel('人物资产').getByRole('button', { name: '一键补充描述' }).click();
  // 从下拉里选一张 → 它立刻成为本段「已选」并成为编辑对象（选图这件事只有一个出口）。
  await page.getByLabel('选择人物参考图').selectOption({ label: '林夏_正面.png' });
  await expect(page.getByLabel('林夏_正面.png描述')).toHaveValue(/^林夏_正面；主色：/);
  const palette = page.getByLabel('林夏_正面.png色卡').locator('span');
  await expect(palette.first()).toBeVisible();
  expect(await palette.count()).toBeLessThanOrEqual(8);
  await page.getByLabel('人物资产').getByRole('button', { name: '清空描述' }).click();
  await expect(page.getByLabel('林夏_正面.png描述')).toHaveValue('');
  // 清空描述只动描述，不动图片：下拉里仍是「占位项 + 2 张」，且本次已选标签不动。
  await expect(page.getByLabel('人物资产').locator('select option')).toHaveCount(3);
  await expect(page.getByLabel('本段已选人物')).toContainText('林夏_正面.png');
  // 人工点「一键补充 AI 描述」：只补本组空描述，逐张调用视觉模型。
  await page.getByLabel('人物资产').getByRole('button', { name: '一键补充 AI 描述' }).click();
  await expect(page.getByLabel('林夏_正面.png描述')).toHaveValue('黑色短发，白色衣领');
  // 换一张看：下拉里选中即绑定本段，描述**直接**进 ①，中间没有确认动作（2026-10-05 取消人工「确认描述」）。
  await page.getByLabel('选择人物参考图').selectOption({ label: '书房.png' });
  await expect(page.getByLabel('书房.png描述')).toHaveValue('黑色短发，白色衣领');
  // 「成品与质检」面板已移除：① 只读位直接在卡片上读。
  await expect(page.locator('.shot-card').first().locator('.readonly-field').first()).toContainText('黑色短发，白色衣领');
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
  await openSection(page, '剧本原稿');
  await expect(page.getByLabel('原剧本编辑区')).toContainText('Word 导入测试');
});

test('imports a Word document renamed to .txt without mojibake', async ({ page }) => {
  const word = await writeWord(createProject('甲：伪装成 txt 的 Word 正文。', '伪装样例'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入剧本' }).click();
  // 扩展名是 .txt、内容却是 docx：按内容魔数分流，不得走文本解码兜底。
  await (await chooser).setFiles({ name: '倒查三代_定稿版剧本.txt', mimeType: 'text/plain', buffer: Buffer.from(word) });
  await openSection(page, '剧本原稿');
  await expect(page.getByLabel('原剧本编辑区')).toContainText('伪装成 txt 的 Word 正文');
  const value = await page.getByLabel('原剧本编辑区').inputValue();
  expect(value).toContain('甲：伪装成 txt 的 Word 正文。');
  expect(value).not.toContain('\uFFFD');
});

test('mobile layout keeps controls usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  /**
   * 窄屏可用的判据换成两处**常显**控件 + 一处展开后的段内容。
   * 原先断言的「人物固定锚点」自 P4 起挂在左栏「人物设定与弧光」段且**仅 AI 模式渲染**
   * （老大裁定「严格按图 1 隐藏」），本地态取不到，故锚点可达性移到 AI 用例里验。
   */
  await expect(page.locator('.engine-switch')).toBeVisible();
  // 第二处常显控件原为「本集校验」页签；该面板已于 2026-10-06 整体移除 → 换成右栏导演板。
  await expect(page.locator('.director-pane')).toBeVisible();
  await openSection(page, '剧本原稿');
  await expect(page.getByLabel('原剧本编辑区')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
});

test('switching project does not carry unsaved script text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await openSection(page, '剧本原稿');
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
  await openSection(page, '剧本原稿');
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
  // 跳转把目标镜的卡片选中（原「本集校验」页签已随面板移除）。
  await expect(page.locator('.shot-card.selected')).toHaveCount(1);

  // 2) 换成单集短稿并补全：一键生成 → 人工填写禁改的 ④构图。
  /**
   * 原先这里还有「填人物 / 场景固定锚点 → 确认设定」两步，自 P4 起**已不在本路径上**：
   * 该组控件挪进左栏「人物设定与弧光」段且仅 AI 模式渲染。本例走本地规则路径，
   * 故不再确认视觉设定 —— 且这不影响导出：`VISUAL_UNCONFIRMED` 与 `CHARACTER_ANCHOR`
   * 本就都是 warning（`issuePolicy` 口径），人工确认类的判据不阻断导出。
   */
  await page.getByLabel('原剧本编辑区').fill('# 第一场 书房\n甲：这封信你动过？\n乙：没有。');
  await page.getByRole('button', { name: '保存原稿版本' }).click();
  await page.getByRole('button', { name: '重新规划' }).click();
  await page.getByRole('button', { name: '一键生成' }).click();
  await expect(page.getByText(/本地规则导演已填充/).first()).toBeVisible({ timeout: 30000 });
  /**
   * P4 第二小步 b：审阅台**整 P 铺开**，不再有镜页签 —— 直接遍历本段的卡片逐镜填 ④构图。
   * 同名输入框每镜一个，故一律 scoped 到 `.shot-card`，否则选择器歧义。
   */
  const shotCards = page.locator('.shot-card');
  const shotCount = await shotCards.count();
  for (let index = 0; index < shotCount; index += 1) {
    await shotCards.nth(index).getByLabel('构图').fill('门框占左前景，人物居中偏左，书桌位于右后景');
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

/**
 * 生成作业的暂停 / 继续 / 终止：
 * 整本生成是长循环，必须切成可交互的分片——暂停与终止都停在分片边界上，已完成的分片已落库。
 * 造稿刻意做密（52 集 × 4 场 × 16 行），保证作业足够长，足以在运行中完成暂停→继续→终止。
 */
function buildDenseBook(episodes: number, scenes: number, rows: number): string {
  const names = ['林夏', '陈默', '苏清苒', '顾南沉'];
  const lines: string[] = [];
  for (let episode = 1; episode <= episodes; episode += 1) {
    lines.push(`第${episode}集 第${episode}夜`);
    for (let scene = 1; scene <= scenes; scene += 1) {
      lines.push(`# 第${scene}场 书房${scene} · ${scene % 2 ? '白天' : '傍晚'}`);
      for (let row = 1; row <= rows; row += 1) {
        const who = names[(episode + row) % names.length];
        lines.push(row % 3 === 0
          ? `${who}按住桌面上的信封，右手指尖停在裂开的封蜡上，身体向门口方向侧转，视线落在门缝上。`
          : `${who}：这封信第${episode}集${scene}场第${row}句，你动过没有，我要一个说法。`);
      }
    }
  }
  return lines.join('\n');
}

test('生成作业可暂停、可继续、可终止，终止后已完成的集保留', async ({ page }) => {
  test.setTimeout(LONG_FLOW_MS);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await openSection(page, '剧本原稿');
  await page.getByLabel('原剧本编辑区').fill(buildDenseBook(52, 4, 16));
  await page.getByRole('button', { name: '保存原稿版本' }).click();
  await page.getByRole('button', { name: '重新规划' }).click();
  await expect(page.locator('.episode-list button')).toHaveCount(52);

  await page.getByRole('button', { name: '选择集生成' }).click();
  await page.getByRole('button', { name: '全选', exact: true }).click();
  await page.getByRole('button', { name: '生成选中的 52 集' }).click();
  const pause = page.getByRole('button', { name: '暂停' });
  await pause.waitFor({ timeout: 30000 });
  // 面板在生成中频繁重渲染，按钮会被 React 替换：用 force 跳过「元素稳定」等待，避免误判超时。
  await pause.click({ force: true });

  const resume = page.getByRole('button', { name: '继续' });
  await expect(resume).toBeVisible();
  await expect(page.getByText(/已暂停/).first()).toBeVisible();
  // 暂停必须真的停在分片边界：先让 React 把已排队的更新提交完，再定时长条宽度必须纹丝不动。
  await page.waitForTimeout(400);
  const frozen = await page.locator('.progress-track div').getAttribute('style');
  await page.waitForTimeout(1500);
  expect(await page.locator('.progress-track div').getAttribute('style')).toBe(frozen);

  await resume.click({ force: true });
  await expect(pause).toBeVisible();
  // 继续后确实在推进：等到至少有一批集写进导演板。
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: '终止' }).click({ force: true });
  await expect(page.getByText(/已终止/).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.progress-panel')).toHaveCount(0);
  // 终止不回退：已写入的集仍留着「已生成」标记，可继续接着跑（此集已写、不因终止丢）。
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('选择集生成在整本工程上逐集回填，不漏集且不卡死', async ({ page }) => {
  test.setTimeout(LONG_FLOW_MS);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await openSection(page, '剧本原稿');
  await page.getByLabel('原剧本编辑区').fill(buildBook());
  await page.getByRole('button', { name: '保存原稿版本' }).click();
  await page.getByRole('button', { name: '重新规划' }).click();
  await expect(page.locator('.episode-list button')).toHaveCount(52);
  await page.getByRole('button', { name: '选择集生成' }).click();
  await page.getByRole('button', { name: '全选', exact: true }).click();
  await page.getByRole('button', { name: '生成选中的 52 集' }).click();
  await expect(page.getByText(/选集生成完成/).first()).toBeVisible({ timeout: 60000 });
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

/**
 * 选择集生成：**只处理勾选的集** —— 这正是它取代「全部分集生成」的理由（补跑一集不必整本重跑）。
 * 默认只勾当前集；再勾第 3 集后生成 2 集，未勾选的集不得出现「已生成」标记。
 */
test('选择集生成只处理勾选的集', async ({ page }) => {
  test.setTimeout(LONG_FLOW_MS);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await openSection(page, '剧本原稿');
  await page.getByLabel('原剧本编辑区').fill(buildBook());
  await page.getByRole('button', { name: '保存原稿版本' }).click();
  await page.getByRole('button', { name: '重新规划' }).click();
  await expect(page.locator('.episode-list button')).toHaveCount(52);

  await page.getByRole('button', { name: '选择集生成' }).click();
  const boxes = page.locator('.picker-list input[type="checkbox"]');
  await expect(boxes).toHaveCount(52);
  // 默认只勾当前集：补跑一集是高频诉求，不该先逼用户「全不选」。
  await expect(boxes.nth(0)).toBeChecked();
  await expect(page.getByRole('button', { name: '生成选中的 1 集' })).toBeEnabled();
  await boxes.nth(2).check();
  await page.getByRole('button', { name: '生成选中的 2 集' }).click();
  await expect(page.getByText(/选集生成完成：2\/2 集/).first()).toBeVisible({ timeout: 60000 });

  // 勾选的集已生成；未勾选的第 2 集不得被打标 —— 这是「只处理勾选的集」的判据。
  await expect(page.locator('.segment-strip .gen-tag').first()).toBeVisible();
  await page.locator('.episode-list button').nth(1).click();
  await expect(page.locator('.segment-strip .gen-tag')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/**
 * 有参考图的存档才是真的重 —— 但重的**不是数据层**。
 *
 * 实测（2026-10-04，Node 侧隔离基准）：52 集 / 6240 镜 / 208 张图的 69.8MB 存档，
 * `JSON.parse` 89ms、`migrateProject`（zod 严格校验）**仅 6ms**、`structuredClone` 147ms、
 * `JSON.stringify` 250ms —— 数据层合计约 240ms，**凑不出老大感受到的三秒**。
 *
 * 真正的三秒在渲染层：缩略图只显示 56×56，但 `data:image/...` 直接挂 `src` 会让浏览器
 * 按**原图分辨率**在提交帧里解码（`loading="lazy"` 只能少解几张、免不掉）。它既不计入 `longtask`、
 * 也几乎不落在「DOM 就绪」之后 —— 所以「等元素出现」的旧口径两头都漏。
 * 改成「进视口才解码 + object URL」后，同一份 55.1MB 存档 DOM 就绪 3658ms → **604ms**。
 *
 * 这里用 12 张 1024×1024 的**不可压缩噪声** PNG（每张约 4.6MB，刻意放大解码成本）撑起体积，
 * 再用 `waitForMainThreadIdle` 量「主线程真正空闲」，两个口径都打印出来。
 */
test('带参考图的存档打开不卡顿', async ({ page }) => {
  test.setTimeout(LONG_FLOW_MS);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const bucket = window as unknown as { __longTasks: number[] };
    bucket.__longTasks = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) bucket.__longTasks.push(entry.duration); }).observe({ entryTypes: ['longtask'] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  // 等自动存档落盘，否则读不到「当前项目」这条记录。
  await page.waitForTimeout(1200);

  const archiveBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const context = canvas.getContext('2d')!;
    const images: Record<string, unknown>[] = [];
    for (let index = 0; index < 12; index += 1) {
      /**
       * 必须用**不可压缩的噪声**：纯色 PNG 会被压到几十 KB，等于把参考图体积抹掉了。
       * 真实参考图（照片级）每张 1024×1024 约 2MB，噪声像素能复现这个量级。
       */
      const pixels = context.createImageData(1024, 1024);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        pixels.data[offset] = Math.random() * 255;
        pixels.data[offset + 1] = Math.random() * 255;
        pixels.data[offset + 2] = Math.random() * 255;
        pixels.data[offset + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      images.push({
        id: `perf-img-${index}`, name: `ref-${index}.png`, kind: 'character',
        sha256: String(index).padEnd(64, 'a'), version: 1, description: '性能诊断用参考图',
        dataUrl: canvas.toDataURL('image/png'),
      });
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      // 不指定版本：应用会随功能演进升级库版本（参考图独立存储时 1 → 2），硬编码旧版本会抛 VersionError。
      const request = indexedDB.open('script-storyboard-workbench');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('打开存档库失败'));
    });
    const current = await new Promise<string>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readonly');
      const request = transaction.objectStore('drafts').get('active-project');
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : '');
      request.onerror = () => reject(request.error ?? new Error('读取存档失败'));
    });
    // 资产库是项目级单源（2026-10-05）：图片写进 project.assets，不再逐集挂。
    const project = JSON.parse(current) as { assets?: Record<string, unknown>[] };
    project.assets = [...(project.assets ?? []), ...images];
    const next = JSON.stringify(project);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').put(next, 'active-project');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('写入存档失败'));
    });
    db.close();
    return next.length;
  });

  const started = Date.now();
  await page.reload();
  /**
   * DOM 就绪口径改为「工作区建起来」（导演板段条常显）。
   * 参考图自 P4 起挂在左栏「资产」折叠段里，**折叠即卸载** —— 若继续以缩略图
   * 计数为口径，测到的会变成「reload + 手动展开段」的耗时，把交互成本混进启动耗时。
   */
  await expect(page.locator('.segment-strip button').first()).toBeVisible({ timeout: 60000 });
  const domReady = Date.now() - started;
  const interactive = await waitForMainThreadIdle(page, 400, 30000);
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  const longest = longTasks.length ? Math.max(...longTasks) : 0;
  const total = longTasks.reduce((sum, value) => sum + value, 0);
  console.log(`[启动性能·带图] 存档 ${(archiveBytes / 1024 / 1024).toFixed(1)}MB · DOM 就绪 ${domReady}ms · 主线程空闲（真可交互）${interactive}ms · 单次最长任务 ${Math.round(longest)}ms · 长任务累计 ${Math.round(total)}ms（${longTasks.length} 次）`);

  /**
   * 验证**产物**而不是「节点存在」：图片必须真的解码出来（`naturalWidth > 0`）。
   * 只验节点计数会漏掉「图根本没加载」—— 那同样会让 DOM 就绪很快，
   * 于是护栏会在功能已经坏掉的情况下继续保持绿色（本项目明令反对的假绿）。
   *
   * 2026-10-06 资产面板改版后口径随之改变：面板**不再逐张铺缩略图**，每个分类只有一个下拉 +
   * 已选标签，缩略图只属于「当前正在编辑的那一张」（`.asset-editor img`，仍走 `Thumb` 的视口门控）。
   * 判据于是拆成两半：① 默认**一张都不渲染**（12 张重图不再参与首屏）；② 从下拉里选一张后
   * 恰好 1 张，且它真的解码出来（`naturalWidth > 0`）。
   */
  await openSection(page, '资产');
  await expect(page.locator('.asset-editor img')).toHaveCount(0);
  await page.getByLabel('选择人物参考图').selectOption({ index: 1 });
  await expect(page.locator('.asset-editor img')).toHaveCount(1);
  await page.locator('.asset-editor img').scrollIntoViewIfNeeded();
  await expect(page.locator('.asset-editor img')).toHaveAttribute('src', /^data:image\//, { timeout: 20000 });
  const rendered = await page.evaluate(() => {
    const node = document.querySelector<HTMLImageElement>('.asset-editor img');
    return { total: node ? 1 : 0, decoded: node && node.complete && node.naturalWidth > 0 ? 1 : 0 };
  });
  console.log(`[启动性能·带图] 缩略图 ${rendered.total} 个节点 · 已解码 ${rendered.decoded} 张（默认 0 张，选中哪张解码哪张）`);
  expect(rendered.decoded).toBeGreaterThan(0);

  expect(errors).toEqual([]);
  expect(interactive).toBeGreaterThan(0);
  // DOM 就绪基线 ≈ 600ms；回退到「dataUrl 直挂 src」会立刻弹回 3600ms 量级，这条专门拦它。
  expect(domReady).toBeLessThan(2500);
  // 只拦「回到卡死」的回归：真实数字由上一行 print 记录，收紧阈值要有实测依据。
  expect(longest).toBeLessThan(2000);
  expect(interactive).toBeLessThan(20000);
});

/**
 * 启动关键路径的回归护栏（老大反馈「有剧本缓存时打开极其卡顿」）。
 *
 * 打开一次存档要：IndexedDB 读全文 → `JSON.parse` → `migrateProject`（zod 全量校验 + 深拷贝）
 * → 首屏重建整本与分集按钮。这些全在主线程同步跑，任何一处变重都会直接表现为「打开就卡住」。
 * 这里用真实规模存档（52 集密集本）测两件事：首屏可交互时长、期间的单次最长任务 ——
 * 后者才是「界面卡死不动」的直接观感（长任务期间浏览器无法响应输入）。
 * 注释与解析层同理：凡「只在展开/展开后才需要」的整本工作，一律不得留在启动路径上。
 */
test('有存档时打开不卡顿：首屏可交互且无超长任务', async ({ page }) => {
  test.setTimeout(LONG_FLOW_MS);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // 「重新规划」会先弹确认框；不接管就会被自动 dismiss，规划不执行、依旧只有样例那一集。
  page.on('dialog', (dialog) => void dialog.accept());
  // 长任务观测必须在 reload 之前装好，否则测不到启动那一段。
  await page.addInitScript(() => {
    const bucket = window as unknown as { __longTasks: number[] };
    bucket.__longTasks = [];
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) bucket.__longTasks.push(entry.duration); }).observe({ entryTypes: ['longtask'] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  // 左栏「剧本原稿」段默认收起，编辑区在段内（折叠即卸载）——先展开再谈回填。
  await openSection(page, '剧本原稿');
  /**
   * 必须等样例原文被回填进编辑区再填新稿：SourcePane 有个「换项目/换版本 → 重置编辑区」的 effect，
   * React 的提交可能晚于 `fill`，会把刚填的内容覆盖回样例原文，于是「保存原稿版本」仍是灰的。
   * 等它回填完成（即该 effect 已跑完），后面的 fill 才不会被打回。
   */
  const editor = page.getByLabel('原剧本编辑区');
  await expect(editor).not.toHaveValue('', { timeout: 10000 });
  const dense = buildDenseBook(52, 4, 16);
  await editor.fill(dense);
  await expect(editor).toHaveValue(dense);
  await page.getByRole('button', { name: '保存原稿版本' }).click();
  await page.getByRole('button', { name: '重新规划' }).click();
  await expect(page.locator('.episode-list button')).toHaveCount(52);
  // 等自动存档真正落盘（300ms 合并窗口 + IndexedDB 写入），否则 reload 读到的是空档。
  await page.waitForTimeout(1500);

  const started = Date.now();
  await page.reload();
  await expect(page.locator('.episode-list button')).toHaveCount(52, { timeout: 30000 });
  const domReady = Date.now() - started;
  const interactive = await waitForMainThreadIdle(page, 400, 30000);
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  const longest = longTasks.length ? Math.max(...longTasks) : 0;
  const total = longTasks.reduce((sum, value) => sum + value, 0);
  console.log(`[启动性能] DOM 就绪 ${domReady}ms · 主线程空闲（真可交互）${interactive}ms · 单次最长任务 ${Math.round(longest)}ms · 长任务累计 ${Math.round(total)}ms（${longTasks.length} 次）`);

  expect(errors).toEqual([]);
  expect(interactive).toBeGreaterThan(0);
  // 阈值取宽松口径：只拦「回到卡死」的回归，不追求极致（dev server 下 StrictMode 会放大一档）。
  expect(longest).toBeLessThan(2000);
  expect(total).toBeLessThan(4000);
});

/**
 * 接口面板：**没有厂商下拉**（由地址自动识别）、**也没有保存按钮**（密钥填入即自动常驻）。
 * 密钥只驻留内存、不写 localStorage；留空时由主进程用本机私有配置补齐，
 * 界面上另以布尔量呈现「本机是否已配置」。
 * 地址与模型来自本机 .env.local（该文件被 .gitignore 排除，不进版本库），
 * 断言口径与本机配置对齐，换机器或无该文件时同样自洽。
 */
test('interface settings auto-detects the vendor and keeps the key resident without a save button', async ({ page }) => {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const configured: Record<string, string> = existsSync(envPath)
    ? Object.fromEntries(readFileSync(envPath, 'utf-8').split(/\r?\n/u)
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }))
    : {};
  await page.goto('/');
  // 工具栏与空工作台各有一个同名按钮，须限定到主区，避免 strict mode 命中两个。
  await page.getByRole('main').getByRole('button', { name: '接口设置' }).click();
  // 厂商不可选：只能凭地址自动识别。
  await expect(page.getByLabel('厂商')).toHaveCount(0);
  // 密钥可手填：有且仅有一个密码框，且初始为空 —— 本机配置的密钥绝不回显到界面。
  // exact 必须开：默认子串匹配会把 aria-label='本机密钥状态' 一起算进来，命中 2 个。
  const keyBox = page.getByLabel('密钥', { exact: true });
  await expect(keyBox).toHaveCount(1);
  await expect(keyBox).toHaveAttribute('type', 'password');
  await expect(keyBox).toHaveValue('');
  // 「填一次即常驻，除非主动删改」：界面不设保存按钮，靠占位符与状态行说清本机那把还在。
  await expect(page.getByRole('button', { name: '保存到本机' })).toHaveCount(0);
  await expect(keyBox).toHaveAttribute('placeholder', /本机已保存|自动常驻本机/);
  // 地址预填自本机 .env.local；无该文件时手填一个，保证后续断言换机器也自洽。
  const endpointBox = page.getByLabel('接口地址');
  await expect(endpointBox).toHaveValue(configured.VITE_WORKBENCH_API_ENDPOINT ?? '');
  if (!(configured.VITE_WORKBENCH_API_ENDPOINT ?? '')) await endpointBox.fill('https://api.example.test/v1');
  // url 与 key 未就绪前不渲染「模型」项（浏览器预览下本机密钥一律视为未配置）。
  await expect(page.getByLabel('模型')).toHaveCount(0);
  // 保密护栏：手填的密钥只驻留内存，绝不写进 localStorage。
  await keyBox.fill('sk-e2e-probe-not-a-real-key');
  await expect(keyBox).toHaveValue('sk-e2e-probe-not-a-real-key');
  const stored = await page.evaluate(() => {
    const values: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const name = localStorage.key(index);
      if (name) values.push(localStorage.getItem(name) ?? '');
    }
    return values.join('\u0001');
  });
  expect(stored).not.toContain('sk-e2e-probe-not-a-real-key');
  // 自动常驻：填完即写本机，不需要点任何按钮。浏览器预览没有主进程可写，
  // 状态行必须给出可照做的说明（失败可见化），且绝不触碰真实 .env.local。
  await expect(page.getByLabel('本机密钥状态')).toContainText(/未能写入本机私有配置|已存本机/, { timeout: 5000 });
  expect(existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '').not.toContain('sk-e2e-probe-not-a-real-key');
  // key 就绪后「模型」项才出现，并沿用本机配置的模型名。
  await expect(page.getByLabel('模型')).toHaveValue(configured.VITE_WORKBENCH_API_MODEL ?? '');
  // 保留：思考强度、连接测试，以及本机密钥的配置状态。
  await expect(page.getByLabel('思考强度')).toBeVisible();
  await expect(page.getByLabel('本机密钥状态')).toBeVisible();
  await expect(page.getByRole('button', { name: '接入并拉取模型' })).toBeVisible();
  // 技术项中英对照：英文在前、中文括注。
  await expect(page.getByText('url（接口地址）')).toBeVisible();
  await expect(page.getByText('key（密钥）')).toBeVisible();
});

/**
 * AI 主路径：AI 就绪时「一键生成」跳过本地预生成，改为逐段「依次推理」——
 * 并把上一段收尾的 ⑦光源 / ⑨站位 / ⑭衔接 传入下一段的上下文；单段失败只回退该段的本地结果。
 * 浏览器路径的文本通道走 `fetch('/api/script/generate')`，用 page.route 造一个可控的「模型」。
 *
 * P3 起本用例还承担两条新判据：
 * - **上下文不截断**（§4.2 第 5/6 项）：请求里必须带本集原文、人物名册、弧光位置、上段完整结果；
 * - **人名防幻觉**（§4.2 第 7 项）：让「模型」在 ⑨站位 里写出名册外的姓名，该镜必须改用本地结果，
 *   并在完成文案里**可见**（失败可见化：不能悄悄回退）。
 */
test('ai-first one click reasons segment by segment, carries context and falls back per segment', async ({ page }) => {
  const seen: { id: string; previousLight: string; previousBlocking: string; previousTransition: string }[] = [];
  /** P3 · 不截断上下文的取证：本集原文 / 名册 / 弧光位置 / 上段完整结果。 */
  const seenContext: { id: string; shots: number; script: string; cast: string[]; arc: string; previousShots: number }[] = [];
  const liveLight = '南侧窄窗冷色自然光';
  const liveBlocking = '林夏在左三分之一，陈默在右三分之一';
  const liveTransition = '动作接动作（接住上一镜的手部动作）';
  await page.route('**/api/script/generate', async (route) => {
    const body = route.request().postDataJSON() as {
      segment: { id: string; shots: { id: string }[] };
      context: {
        previousLight: string; previousBlocking: string; previousTransition: string;
        script?: string; cast?: string[]; arc?: string; previousShots?: unknown[];
      };
    };
    seen.push({ id: body.segment.id, previousLight: body.context.previousLight, previousBlocking: body.context.previousBlocking, previousTransition: body.context.previousTransition });
    seenContext.push({
      id: body.segment.id,
      shots: body.segment.shots.length,
      script: body.context.script ?? '',
      cast: body.context.cast ?? [],
      arc: body.context.arc ?? '',
      previousShots: body.context.previousShots?.length ?? 0,
    });
    // 第 2 段故意失败：验证「单段失败只回退该段本地结果，其余段继续」。
    if (body.segment.id === 'P02') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '模型不可用' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shots: body.segment.shots.map((shot, index) => ({
          shotId: shot.id,
          fields: {
            composition: '门框占左前景，人物居中偏左，书桌位于右后景', scale: '中景', lens: '35mm', movement: '缓慢右移',
            light: liveLight, atmosphere: '克制，室内低压',
            // 末段首镜写一个名册外的姓名：人名防幻觉必须把**这一镜**退回本地结果。
            blocking: body.segment.id === 'P04' && index === 0 ? '秦昭立于画面左侧三分之一' : liveBlocking,
            action: '无', performance: '无', sound: '无', transition: liveTransition,
          },
        })),
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  // 接入并开启 AI：地址 + 手填密钥 → 模型项出现 → 勾选「启用 AI 增强」。
  await page.getByRole('button', { name: '接口设置' }).click();
  await page.getByLabel('接口地址').fill('https://api.example.test/v1');
  await page.getByLabel('密钥', { exact: true }).fill('sk-e2e-ai-first');
  await page.getByLabel('模型').fill('e2e-model');
  await page.getByLabel('启用AI增强').check();
  /** exact 必开：同一页面上 toast 的「关闭提醒」也会被子串匹配命中（实测 strict mode violation）。 */
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  /**
   * 「人物设定与弧光」段**仅 AI 模式渲染**（P4 定稿「严格按图 1」）。
   * 它不是一个显示开关，而是入口的分侧：`project.visual` 数据侧两侧都在消费
   * （`skeleton.values()` 的文字兜底 / validator 的锚点判据），本地只是不提供录入入口。
   * 这里在 AI 就绪后验它确实出现、可录入，且锚点为空时「确认设定」不可点。
   */
  await openSection(page, '人物设定与弧光');
  await expect(page.getByLabel('人物固定锚点')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认设定' })).toBeDisabled();
  /**
   * 生成区随 AI 就绪换形态（P4 定稿：生成区固定在左栏底部）。
   * 此前只覆盖了顶栏那枚生成键，**左栏生成区没有任何断言** —— 若它的就绪判定写错，
   * 会出现「顶栏说 AI、左栏说本地」的自相矛盾而无人拦。
   */
  await expect(page.locator('.gen-zone-note')).toHaveClass(/ai-ready/);
  await expect(page.locator('.gen-zone-note')).toContainText('主路径：AI 依次推理');
  await expect(page.getByRole('button', { name: '生成当前集' })).toContainText('AI 依次推理');

  // UI 必须真的反映「已接入 AI」：不再只是一句悬停提示，按钮本身换成 AI 依次推理的图标与文案。
  const generateButton = page.getByRole('button', { name: '一键生成' });
  await expect(generateButton).toHaveAttribute('data-ai', 'ready');
  await expect(generateButton).toContainText('AI 依次推理');
  await expect(page.getByRole('button', { name: '选择集生成' })).toBeVisible();

  await generateButton.click();
  await expect(page.getByText(/AI 依次推理完成/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/1 段未通过已回退本地规则结果/)).toBeVisible();
  // 人名防幻觉：回退**必须可见**（不许悄悄替换成 AI 的味道）。
  await expect(page.getByText(/1 镜因写出名册外姓名已改用本地结果/)).toBeVisible();

  // 依次推理：按段序请求，且从第 2 段起携带上一段收尾的上下文。
  expect(seen.map((item) => item.id)).toEqual(['P01', 'P02', 'P03', 'P04']);
  expect(seen[0].previousLight).toBe('');
  expect(seen[1].previousLight).toBe(liveLight);
  expect(seen[1].previousBlocking).toBe(liveBlocking);
  expect(seen[1].previousTransition).toBe(liveTransition);
  /**
   * 第 2 段（P02）失败回退本地后，第 3 段拿到的是**板上真实的上段结果**（本地兜底段的收尾）——
   * P3 前的口径是「失败段被跳过、第 3 段沿用第 1 段」，那会让 AI 按一个不在板上的状态续写，
   * 跨段的光源链路与左右关系反而对不上。此处以 ⑨站位 为证：本地站位必然不是 mock 那句。
   */
  expect(seen[2].previousBlocking).not.toBe(liveBlocking);

  // P3 · 上下文不截断：本集原文（含本段之前的场次）、人物名册、弧光位置、上段完整结果都在请求里。
  expect(seenContext[0].script).toContain('林夏按住桌面上的信封');
  expect(seenContext[0].cast).toEqual(expect.arrayContaining(['林夏', '陈默']));
  expect(seenContext[0].arc).not.toBe('');
  expect(seenContext[0].previousShots).toBe(0);              // 首段无上段
  expect(seenContext[1].previousShots).toBe(seenContext[0].shots);   // 第 2 段带第 1 段全部镜头
  expect(seenContext[2].previousShots).toBe(seenContext[1].shots);   // 回退段也算「上段完整结果」
  expect(seenContext[3].previousShots).toBe(seenContext[2].shots);

  // 4 段全部标记「已生成」（含回退段），且来源逐镜区分：P01 = AI，P02 = 本地兜底。
  await expect(page.locator('.segment-strip .gen-tag')).toHaveCount(4);
  // 「成品与质检」面板已整体移除：AI 态与本地态的右栏都只剩导演板（反向锁死面板不回流）。
  await expect(page.locator('.result-pane')).toHaveCount(0);
  await expect(page.locator('.preview')).toHaveCount(0);
  await page.locator('.segment-strip button').nth(0).click();
  // 整 P 铺开后每镜各有一枚来源标，取本段首卡那一枚（P01 全镜都是 AI）。
  await expect(page.locator('.shot-card .source-tag').first()).toHaveText('来源：AI');
  await page.locator('.segment-strip button').nth(1).click();
  await expect(page.locator('.shot-card .source-tag').first()).toHaveText('来源：本地');
});

/**
 * 「人物设定与弧光」按**已上传的人物资产**自动列出人物（2026-10-06 第二步 · 老大原话：
 * 「人物弧光界面只检测资产的人物名称并有相应的填写人物设定和人物弧光的文本框」）。
 *
 * 三条判据，缺一不可：① 人名取自**人物资产文件名去扩展名**（场景资产不掺进来）；
 * ② 填写人物文本**不得**动固定锚点的确认状态；③ 真的**落盘** —— 直接读回 IndexedDB 存档比对形状，
 * 不用界面自证（界面自证只能证明它在内存里）。
 */
test('人物设定与弧光按人物资产列出文本框，填写后落盘', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await openSection(page, '资产');
  const first = await page.screenshot({ clip: { x: 0, y: 0, width: 40, height: 40 } });
  const second = await page.screenshot({ clip: { x: 200, y: 300, width: 40, height: 40 } });
  for (const [name, buffer] of [['林夏.png', first], ['陈默.png', second]] as const) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入人物' }).click();
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
  }
  // 该段**仅 AI 模式渲染**，故先让 AI 就绪（与上面那条 AI 主路径用例同一套动作）。
  await page.getByRole('button', { name: '接口设置' }).click();
  await page.getByLabel('接口地址').fill('https://example.test/v1/chat/completions');
  await page.getByLabel('密钥', { exact: true }).fill('sk-e2e-cast');
  await page.getByLabel('模型').fill('e2e-model');
  await page.getByLabel('启用AI增强').check();
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await openSection(page, '人物设定与弧光');
  await expect(page.getByLabel('林夏人物设定')).toBeVisible();
  await expect(page.getByLabel('陈默人物弧光')).toBeVisible();
  // 摘要同时报「按人物那半的人数」与「锚点那半的确认状态」——
  // 只报后者的话，填了人物设定而没确认锚点时，摘要会一直写「未填写」，与眼前所见矛盾。
  await expect(page.locator('.rail-section-head[data-section="人物设定与弧光"] .rail-section-summary')).toHaveText('人物 2 · 未填写');

  await page.getByLabel('林夏人物设定').fill('女，24 岁，白衬衫；短发');
  await page.getByLabel('林夏人物弧光').fill('被误解 → 自证 → 离开');
  // ② 填人物文本不得动锚点：锚点仍为空 →「确认设定」仍不可点。
  await expect(page.getByRole('button', { name: '确认设定' })).toBeDisabled();

  // ③ 落盘证据：等自动存档落盘后直接读回 IndexedDB（与启动性能用例同一张库）。
  await page.waitForTimeout(1500);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('script-storyboard-workbench');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('打开存档库失败'));
    });
    const raw = await new Promise<string>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readonly');
      const request = transaction.objectStore('drafts').get('active-project');
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : '');
      request.onerror = () => reject(request.error ?? new Error('读取存档失败'));
    });
    db.close();
    return raw;
  });
  const saved = JSON.parse(stored) as { visual: { cast: unknown; confirmed: boolean; character: string } };
  expect(saved.visual.cast).toEqual([{ name: '林夏', setting: '女，24 岁，白衬衫；短发', arc: '被误解 → 自证 → 离开' }]);
  expect(saved.visual.confirmed).toBe(false);
  expect(saved.visual.character).toBe('');
});

/**
 * 解析口径对账（2026-10-05 根治）：分集**持久化**在存档里，升级识别口径后旧存档不会自己重算 ——
 * 用户打开还是旧分集，且毫无提示（老大原话「没变啊」）。
 * 这里模拟一份「旧口径产物」（删掉版本指纹 + 把分集压成一集），断言打开时**自动重建**并给出**可见提示**。
 */
test('旧口径存档打开时自动重建分集并提示', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入剧本' }).click();
  await (await chooser).setFiles({
    name: '口径样例.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 《口径样例》\n\n### 第七集 开局\n\n甲：你好。\n\n### 第八集 收束\n\n乙：再见。\n'),
  });
  await expect(page.locator('.episode-list button')).toHaveCount(2);
  await page.waitForTimeout(1200); // 等自动存档落盘（300ms 合并窗口 + IndexedDB 写入）

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('script-storyboard-workbench');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('打开存档库失败'));
    });
    const raw = await new Promise<string>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readonly');
      const request = transaction.objectStore('drafts').get('active-project');
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : '');
      request.onerror = () => reject(request.error ?? new Error('读取存档失败'));
    });
    const project = JSON.parse(raw) as { parserVersion?: string; episodes: unknown[]; activeEpisodeId: string };
    delete project.parserVersion;                       // 旧存档没有版本指纹
    project.episodes = project.episodes.slice(0, 1);     // 旧口径把整本切成了一集
    project.activeEpisodeId = (project.episodes[0] as { id: string }).id;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').put(JSON.stringify(project), 'active-project');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('写入存档失败'));
    });
    db.close();
  });

  await page.reload();
  // 自动重建：一集 → 两集
  await expect(page.locator('.episode-list button')).toHaveCount(2, { timeout: 30000 });
  // 且必须**可见地**告知，不能静默改用户数据。
  await expect(page.locator('.save-warning', { hasText: '自动重建' })).toBeVisible();
});

/**
 * 参考图与主存档分离（2026-10-05）：图片按 sha256 单独存在 `images` 库，主 JSON 里 `dataUrl` 置空。
 * 这条覆盖**写路径**（`saveDraft` 剥离）与**读路径**（`loadDraft` 装回）的完整往返 ——
 * 分离存储若坏在「装不回」，用户丢掉的是**导入的参考图**，属最高危改动，必须有真实链路护栏。
 */
test('参考图随存档往返：分离存储后仍能读回', async ({ page }) => {
  /** 最小合法 PNG（1×1），base64 —— `prepareImage` 会再过一遍 canvas 缩放。 */
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await openSection(page, '资产');
  const chooser = page.waitForEvent('filechooser');
  // 资产区 = 两类各一组「下拉 + 已选标签」：导入键按组分流，点人物组的「导入」即导到人物。
  await page.getByRole('button', { name: '导入人物' }).click();
  await (await chooser).setFiles({ name: 'roundtrip.png', mimeType: 'image/png', buffer: png });
  // 导入只入库：下拉里立刻多出这一张（占位项 + 1）。
  await expect(page.getByLabel('人物资产').locator('select option')).toHaveCount(2, { timeout: 20000 });
  await page.waitForTimeout(1500); // 等自动存档：剥离写图 → 主 JSON 置空 dataUrl

  await page.reload();
  // reload 会把左栏的展开态一起重置（`openAssets` 属编排层 state），须重新展开才看得到资产。
  await openSection(page, '资产');
  await expect(page.getByLabel('人物资产').locator('select option')).toHaveCount(2, { timeout: 30000 });
  /**
   * 读回判据走**缩略图**：从下拉里选中这一张，编辑区的 `Thumb` 进视口才挂 `src`，
   * 挂上且是 data URL 即证明图片数据被**读回**（分离存储最危险的一类坏就是「装不回」）。
   * 断言用正则而不是「属性存在」：`dataUrl` 若被装成空串，空串不匹配 `data:image/`，照样拦得住。
   */
  await page.getByLabel('选择人物参考图').selectOption({ index: 1 });
  await page.locator('.asset-editor img').scrollIntoViewIfNeeded();
  await expect(page.locator('.asset-editor img')).toHaveAttribute('src', /^data:image\//, { timeout: 10000 });
});

/**
 * 单张删除（2026-10-05 老大反馈第 4 条）：资产是**项目级单源**，删一张即全本失效，
 * 所以这里必须验三件事：① 被集绑定过的图删除前先按影响范围确认；② 全本解除绑定（本段计数回落）；
 * ③ 删除落盘（重载后仍是删掉的状态）。
 */
test('资产可单张删除：确认后全本解除绑定并落盘', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '打开样例' }).click();
  await openSection(page, '资产');
  const first = await page.screenshot({ clip: { x: 0, y: 0, width: 40, height: 40 } });
  const second = await page.screenshot({ clip: { x: 200, y: 300, width: 40, height: 40 } });
  for (const [name, buffer] of [['甲.png', first], ['乙.png', second]] as const) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入人物' }).click();
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
  }
  await expect(page.getByLabel('人物资产').locator('select option')).toHaveCount(3, { timeout: 20000 });

  // 先把「甲.png」绑到本段：从下拉里选它（选中即绑定、同时也是编辑对象），有了引用，删除就必须先确认。
  // 选项顺序 = `project.assets` 过滤后的顺序，故 index 1 即先导入的甲.png。
  await page.getByLabel('选择人物参考图').selectOption({ index: 1 });
  await expect(page.locator('.input-image-pane .pane-title')).toContainText('本段 1/6');
  await expect(page.getByLabel('甲.png描述')).toBeVisible();

  let dialogText = '';
  page.once('dialog', (dialog) => { dialogText = dialog.message(); void dialog.accept(); });
  await page.getByLabel('人物资产').getByRole('button', { name: '删除这张资产' }).click();
  expect(dialogText).toContain('已被 1 集绑定');
  // 删除后编辑区随之关闭（编辑对象已不存在），下拉只剩「占位项 + 乙.png」。
  await expect(page.getByLabel('人物资产').locator('select option')).toHaveCount(2);
  await expect(page.getByLabel('甲.png描述')).toHaveCount(0);
  // 全本解除绑定：本段引用回到 0（否则会留下指向已删资产的悬挂引用）。
  await expect(page.locator('.input-image-pane .pane-title')).toContainText('本段 0/6');

  await page.waitForTimeout(1500); // 等自动存档落盘
  await page.reload();
  await openSection(page, '资产');
  await expect(page.getByLabel('人物资产').locator('select option')).toHaveCount(2, { timeout: 30000 });
});
