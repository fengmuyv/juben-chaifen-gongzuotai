import type { Issue, IssueCategory } from '../../core/model';

/**
 * 闸门规则正本（**叶子模块**，不依赖任何业务模块）：
 * 转场禁词、单镜时长、问题分级表都在这里，供生成层、校验层与审计层共用。
 *
 * 之所以独立成模块：`director` 需要禁词表做衔接兜底，`validator` 需要问题分级表，
 * `audit` 需要问题编号 —— 三者若互相 import 会形成环，故把「规则」下沉到最底层。
 */

/** ⑭ 衔接禁词表：低级转场一律阻断（口径与 ai-manhua-storyboard-qa 一致）。 */
export const transitionForbiddenWords = ['闪黑', '闪白', '黑场', '白场', '叠化', '交叉溶解', '淡入淡出', '单纯推', '单纯拉'] as const;
export const transitionForbiddenPattern = /闪黑|闪白|黑场|白场|叠化|交叉溶解|淡入淡出|单纯推|单纯拉/u;

/** 单镜时长上限（秒）。 */
export const shotDuration = 15;

export const issueCategoryNames: Record<IssueCategory, string> = {
  input: '输入不完整',
  reference: '原图描述未确认',
  source: '剧本结构/台词不一致',
  safety: '内容安全',
  review: '建议复核',
};

/**
 * 闸门分级正本（单源真值）：`severity` 只由这张表决定，调用点不得单独指定。
 *
 * 口径（2026-09-30 裁定）：
 * - `error`（阻断导出）仅限**事实类**问题——输入不完整、原图描述未确认、剧本结构与台词不一致，
 *   以及**内容安全**问题（转场禁词、图号占位）。
 * - `warning`（建议复核）覆盖人工确认与风格建议，不阻断导出；导出按钮也不因任一条而永久失效。
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
  FIELD_REQUIRED: { severity: 'error', category: 'input' },
  PURPOSE_REQUIRED: { severity: 'error', category: 'input' },
  CHARACTER_ANCHOR: { severity: 'error', category: 'input' },
  TRANSITION: { severity: 'error', category: 'input' },
  DIALOGUE_LIMIT: { severity: 'error', category: 'input' },
  IMAGE_LIMIT: { severity: 'error', category: 'input' },
  SCENE_REFERENCE: { severity: 'error', category: 'input' },
  SHOT_SOURCE: { severity: 'error', category: 'input' },
  // 事实 · 原图描述未确认
  VISUAL_UNCONFIRMED: { severity: 'error', category: 'reference' },
  IMAGE_UNCONFIRMED: { severity: 'error', category: 'reference' },
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

export type IssueCode = keyof typeof issuePolicy;
