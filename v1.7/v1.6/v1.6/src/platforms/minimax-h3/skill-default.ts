import type { Issue, IssueCategory } from '../../core/model';

/**
 * 内置默认判据包（P1 · 判据 JSON 化）—— **L0 判据正本的内存副本**。
 *
 * 收拢的是施工方案 §4.1 所说的 L0「两路共用、不得双写」的那部分判据：
 * 转场禁词 / 合规衔接池 / 14 格骨架 / 生成通道白名单 / 闸门分级表。
 * 本文件落地后，`rules.ts` / `skeleton.ts` / `director.ts` **一律从这里取**，不再各自持有字面量；
 * 各模块的**导出名与签名保持原样**，因此所有既有 import 路径一行不改。
 *
 * **为什么不只是「挪个地方」**：这是 P2「运行时从 skill 包读取」的降级基线 ——
 * `resources/skills/<domain>/<skillId>/<version>/rules.json` 就位后，渲染层的 `skills.ts`
 * 有桥走主进程读盘、无桥（浏览器 dev / Vitest）回落本文件，**两条路径必须行为等价**。
 *
 * **为什么用 TS 而不是 JSON**：判据的「为什么」与「双写警示」是最贵的信息，
 * JSON 装不下注释。P2 的磁盘包用 `rules.json`（机读）+ `SKILL.md`（人读、含出处）成对表达，
 * 本文件是二者的内存形态；P2 会加「盘上 rules.json 与本文件逐词一致」的对照断言。
 *
 * ⚠️ **本文件不得 import 任何业务模块**（`director` / `validator` / `audit` / `gate`），
 *    只允许 `src/core/` 的类型 import —— 与 `rules.ts` 同一条叶子纪律。
 */

// ─────────────────────────────────────────────────────────────────────────────
// capability: transition.guard（正本 = ai-manhua-storyboard-qa v1.6）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⑭ 衔接禁词表：低级转场一律阻断。
 *
 * 正本 = `ai-manhua-storyboard-qa/scripts/verify.py` → `TRANSITION_KEYWORDS`
 *        （v1.6 · 2026-09-27 用户令，27 条）。本表原为 v1.4 的 9 条旧口径，
 *        2026-10-05 按 v1.6 补齐 18 条。
 * ⚠️ 双写警示：主进程 `tsconfig.electron.json` 的 `rootDir: "electron"` 使其无法 import 本文件，
 *    故 `electron/script.ts` 另持一份同表。`tests/unit/workbench.test.ts` 有一致性断言兜底 ——
 *    **改本表必须同步改该处，否则 AI 侧闸门与本地闸门脱节**。
 *    （P2 加载器就位后两侧都改为读同一份 `rules.json`，双写与那条断言同步退役。）
 * ⚠️ 口径要点（勿删）：推 / 拉 / 摇 / 移**仅当其被当作「转场手段」时才禁用** —— 故本表用
 *    「单纯推」「推镜转场」这类组合词，而非光秃的「推」「拉」「摇」「移」；**④ 运镜字段的正常
 *    或极缓推拉摇移（≤5% 画幅）不受此限**。本表只用于 ⑭ 字段判定，**不得**用于全文扫描。
 */
export const transitionForbiddenWords = [
  // 黑 / 白场类
  '渐黑', '渐白', '黑屏', '黑场', '白屏', '白场', '闪黑', '闪白',
  // 溶解叠化类
  '叠化', '交叉溶解', '溶解', '淡入', '淡出', '淡入淡出',
  // 推拉摇移类（仅当作为「转场手段」使用时）
  '推镜转场', '拉镜转场', '推拉转场', '摇镜转场', '移镜转场', '单纯推', '单纯拉', '单纯摇', '单纯移',
  // 定格 / 锁帧类
  '定格转场', '定格收尾', '锁帧', '冻结画面',
] as const;

/**
 * 合规衔接手段（**短名**，11 条）：AI 侧 prompt 的「可用手段」枚举与审计共用。
 *
 * 技能 `ai-manhua-storyboard-qa` 的 `TRANSITION_GOOD_KEYWORDS` 为 **13 条**，此处 **11 条**，
 * 归并关系**有意为之、非漏抄**（勿据条数差判定缺失）：
 * - 「匹配动作」已并入「动作接动作」（同义，技能自身亦并列二者）
 * - 「声延后」已并入「L-Cut」（L-Cut 定义即「本镜台词延续到下一镜画面」）
 * 改技能侧正向池时必须回来核对本归并关系。
 */
export const transitionPositivePool = [
  '动作接动作', '视线引导', '遮挡转场', '匹配剪辑', 'J-Cut', 'L-Cut',
  '声音先入', '空镜缓冲', '同向运动顺接', '光影变化接', '焦点转移接',
] as const;

/** 成稿形态要求：只写手段名不算合格，必须落到「这一镜到下一镜具体接的是什么」。 */
export const transitionRequiredShape = '衔接须写明手段 + 匹配的具体元素';

// ─────────────────────────────────────────────────────────────────────────────
// capability: director.intent（⑭ 成稿文案池 · 本地引擎正本）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 合规衔接成稿文案（11 条，与 `transitionPositivePool` 一一对应、同序）。
 *
 * 池内不含具体剧情内容物，避免张冠李戴 —— 「谁的手、什么物体」由镜头证据提供，
 * 本池只给**接法**。选型必须走 `director.pickTransition`（按证据 + 前提过滤），不得按序号盲选。
 */
export const transitionTemplates = {
  /** 对应「动作接动作」：要求前后镜确有可延续的手部动势。 */
  actionMatch: '动作接动作：本镜末的抬手动作接下一镜同一动作的继续，动势方向保持一致',
  /** 对应「视线引导」：本镜末视线落向一侧，下一镜顺该方向切目标物。 */
  eyeLine: '视线引导：本镜末人物视线落向画面一侧，下一镜顺视线方向切到目标物',
  /** 对应「遮挡转场」：技能 v1.8.0「遮挡转场峰值交接完整性」五要素齐备。 */
  occlusion: '遮挡转场：前景遮挡体自画面一侧扫入并覆盖至满幅（满幅峰值保持不少于 8 帧），在遮蔽峰值处完成换景，遮挡体沿同一方向退出后显露新空间，落点恢复至新场次的稳定构图',
  /** 对应「匹配剪辑」：无前提，通用。 */
  matchCut: '匹配剪辑：以前景物体的轮廓匹配下一镜的同形物体，形状与画面位置对齐',
  /** 对应「J-Cut」：下一镜声音先于画面进入。 */
  jCut: 'J-Cut：下一镜的环境声与对话先于画面进入，本镜画面仍在延续',
  /** 对应「L-Cut」：本镜声音延续到下一镜画面。 */
  lCut: 'L-Cut：本镜台词延续到下一镜画面，用声音搭桥完成空间切换',
  /** 对应「声音先入」：无前提，通用。 */
  soundLead: '声音先入：下一镜的脚步声中先于画面出现，形成听觉预期',
  /** 对应「空镜缓冲」：无前提，通用。 */
  emptyBuffer: '空镜缓冲：插入一段空间空镜，承接情绪后再回到人物',
  /** 对应「同向运动顺接」：要求人物有横向位移。 */
  sameDirection: '同向运动顺接：人物横向移动方向与下一镜机位横移方向一致',
  /** 对应「光影变化接」：无前提，通用。 */
  lightShift: '光影变化接：沿本场 ⑦ 光源 的既有光位与色温承接，下一镜在同一明暗关系下起幅',
  /** 对应「焦点转移接」：前后景均需有人物。 */
  focusShift: '焦点转移接：焦点从前景人物转移到后景物体，下一镜以该物体为前景',
} as const;

/**
 * 段末三口径（与镜内衔接不同：这里的「下一段」是段落边界，不是镜与镜）。
 * - 同场次：可原样承接（带情绪走向，故仍是函数，留在 `director.ts`）
 * - 换场次：轴线必然重设，**不得**再写「方位不变」
 * - 本集末镜：不再有下一段，**不得**写「交棒下一段」
 */
export const segmentTailTransition = {
  sceneChange: '换场衔接：本段收束后进入下一场次，轴线按新场次重设，光位与空间底噪随场次切换',
  closing: '本集收束：以本镜落幅收住全集，保持本场轴线与光位不变，不留悬空动势',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// capability: skeleton.fields（14 格骨架正本）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 14 格骨架：**编号、顺序、标签一个不改**（① 人物 … ⑭ 衔接）。
 * ①② 由资产描述注入、⑫ 由原稿注入；其余 11 条为生成通道可填。
 */
export const skeletonFields = [
  { key: 'character', label: '人物参考图的描述' },
  { key: 'scene', label: '场景参考图的描述' },
  { key: 'scale', label: '景别' }, { key: 'composition', label: '构图' }, { key: 'lens', label: '焦距' },
  { key: 'movement', label: '运镜' }, { key: 'light', label: '光源' }, { key: 'atmosphere', label: '氛围' },
  { key: 'blocking', label: '人物站位 + 朝向' }, { key: 'action', label: '肢体动作（方位/动线）' },
  { key: 'performance', label: '微表情' }, { key: 'dialogue', label: '台词 / 内心OS' },
  { key: 'sound', label: '音效' }, { key: 'transition', label: '衔接' },
] as const;

/** 一键生成可填充的 11 条导演字段（③④⑤⑥⑦⑧⑨⑩⑪⑬⑭）；④ 构图与 ⑨ 站位同源生成。 */
export const skeletonGeneratedKeys = ['scale', 'composition', 'lens', 'movement', 'light', 'atmosphere', 'blocking', 'action', 'performance', 'sound', 'transition'] as const;

/** 禁改的 3 条：①② 来自参考图与文字设定，⑫ 来自原稿，一律不得由生成通道改写。 */
export const skeletonProtectedKeys = ['character', 'scene', 'dialogue'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// capability: h3.validate（闸门分级正本）
// ─────────────────────────────────────────────────────────────────────────────

export const issueCategoryNames: Record<IssueCategory, string> = {
  input: '输入不完整',
  reference: '原图描述缺失',
  source: '剧本结构/台词不一致',
  safety: '内容安全',
  review: '建议复核',
};

/**
 * 闸门分级正本（单源真值）：`severity` 只由这张表决定，调用点不得单独指定。
 *
 * 口径（2026-09-30 裁定）：
 * - `error`（阻断导出）仅限**事实类**问题——输入不完整、原图描述缺失、剧本结构与台词不一致，
 *   以及**内容安全**问题（转场禁词、图号占位）。
 * - `warning`（建议复核）覆盖人工确认与风格建议，不阻断导出；导出按钮也不因任一条而永久失效。
 *
 * 2026-10-05 起资产不再需要人工「确认描述」，故 `IMAGE_UNCONFIRMED` 更名为 `IMAGE_UNDESCRIBED`：
 * 判据从「描述未确认」变为「描述为空」，分类名同步为「原图描述缺失」。
 *
 * 新增闸门必须先在此表登记，`add()` 的入参类型会直接约束到本表的键。
 */
export const issuePolicy = {
  // 事实 · 输入不完整
  EMPTY: { severity: 'error', category: 'input' },
  DURATION: { severity: 'error', category: 'input' },
  SEGMENT_NUMBER: { severity: 'error', category: 'input' },
  SHOT_NUMBER: { severity: 'error', category: 'input' },
  SHOT_DURATION: { severity: 'error', category: 'input' },
  SHOT_DURATION_MAX: { severity: 'error', category: 'input' },
  FIELD_REQUIRED: { severity: 'error', category: 'input' },
  PURPOSE_REQUIRED: { severity: 'error', category: 'input' },
  CHARACTER_ANCHOR: { severity: 'warning', category: 'review' },
  TRANSITION: { severity: 'error', category: 'input' },
  DIALOGUE_LIMIT: { severity: 'error', category: 'input' },
  IMAGE_LIMIT: { severity: 'error', category: 'input' },
  SCENE_REFERENCE: { severity: 'error', category: 'input' },
  SHOT_SOURCE: { severity: 'error', category: 'input' },
  // 事实 · 原图描述缺失
  VISUAL_UNCONFIRMED: { severity: 'warning', category: 'reference' },
  IMAGE_UNDESCRIBED: { severity: 'warning', category: 'reference' },
  // 事实 · 剧本结构与台词一致性
  SOURCE_VERSION: { severity: 'error', category: 'source' },
  SOURCE_STRUCTURE: { severity: 'error', category: 'source' },
  DIALOGUE_PROTECTION: { severity: 'error', category: 'source' },
  BEAT_COVERAGE: { severity: 'error', category: 'source' },
  CHARACTER_ANCHOR_DRIFT: { severity: 'error', category: 'source' },
  // 内容安全
  IMAGE_PLACEHOLDER: { severity: 'error', category: 'safety' },
  TRANSITION_FORBIDDEN: { severity: 'error', category: 'safety' },
  // 建议复核（不阻断）
  DIRECTOR_UNCONFIRMED: { severity: 'warning', category: 'review' },
  DIALOGUE_LOAD: { severity: 'warning', category: 'review' },
  SHOT_DENSITY: { severity: 'warning', category: 'review' },
  ACTION_REVIEW: { severity: 'warning', category: 'review' },
  CONTINUITY_REVIEW: { severity: 'warning', category: 'review' },
  CHARACTER_CONTINUITY: { severity: 'warning', category: 'review' },
  BLOCKING_CONTINUITY: { severity: 'warning', category: 'review' },
  COMPOSITION_CONTINUITY: { severity: 'warning', category: 'review' },
  LIGHT_CONTINUITY: { severity: 'warning', category: 'review' },
  AUTO_MATCH_LOW_CONFIDENCE: { severity: 'warning', category: 'review' },
  EPISODE_SPLIT_UNVERIFIED: { severity: 'warning', category: 'review' },
  // 通用一致性审计（`audit.ts`）：**与具体剧本无关**，任何原稿生成后自动执行，不需要为每个项目单独升级。
  AXIS_JUMP: { severity: 'error', category: 'source' },
  TRANSITION_PREMISE: { severity: 'error', category: 'source' },
  SPEAKER_UNTRUSTED: { severity: 'error', category: 'source' },
  BLOCKING_UNKNOWN_SUBJECT: { severity: 'warning', category: 'review' },
  SCALE_SUBJECT_CONFLICT: { severity: 'warning', category: 'review' },
  STAGING_COMPOSITION_CONFLICT: { severity: 'warning', category: 'review' },
} as const satisfies Record<string, { severity: Issue['severity']; category: IssueCategory }>;

/** 允许在当前清单会话中暂时折叠的人工处理型阻断；剧本一致性与内容安全不可忽略。 */
export const ignorableIssueCategories = ['input', 'reference'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// capability: h3.compile（生成通道白名单）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生成通道只允许这 11 条；①②④⑫ 由既有链路注入，任何情况不得由模型改写。
 * 与 `skeletonGeneratedKeys` **同序同集**（此处独立成节是因为主进程侧 `electron/script.ts`
 * 也持有一份同表，P2 加载器就位后两侧统一从 `rules.json` 读）。
 */
export const h3CompileAllowedKeys = ['scale', 'composition', 'lens', 'movement', 'light', 'atmosphere', 'blocking', 'action', 'performance', 'sound', 'transition'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 内置默认包的指纹（P2 · 加载器接线的降级锚）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 内置默认包的指纹 —— **无磁盘包时的降级标识**。
 *
 * `hash` 固定为 `'builtin'` 而**不伪造 SHA-256**：本文件是磁盘包的「JSON 化内存形态」，
 * 没有与之对应的 `SKILL.md` 全文可算哈希；伪造一串十六进制会让「内置包」与「真实包」
 * 在界面与日志里无法区分 —— 那正是溯源锚要解决的问题的反面。
 * 磁盘包的真实锚是各自 `meta.json` 的 `sourceSha256`（`scripts/build-skill-packages.mjs` 计算）。
 *
 * 版本号与磁盘入口包保持一致：内置包**就是** `minimax-h3-video-prompt@2.1.0` 的判据快照。
 */
export const builtinStamp = { skillId: 'minimax-h3-video-prompt', version: '2.1.0', hash: 'builtin' } as const;
