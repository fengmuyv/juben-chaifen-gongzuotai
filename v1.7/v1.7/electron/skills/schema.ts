import { z } from 'zod';

/**
 * Skill 包结构与清单校验（P2 · 加载器接线）
 *
 * 三个文件各有其 schema：`catalog.json`（已装包索引）、`meta.json`（包清单）、`rules.json`（机器读判据）。
 * 校验动作发生在**装载前**，因此这里的原则是：
 *
 * - **`apiVersion` 不匹配即拒绝**（`z.literal`）。宁可让渲染层回落内置默认包，也不猜字段语义 ——
 *   猜错的代价是判据静默错位，比「包没装上」严重得多。
 * - **`sourceSha256` 必须是 64 位小写十六进制**。它是对外的溯源锚（施工方案 §2.2），
 *   格式不合法说明包不是本工程的打包脚本产出的，不该放进来。
 * - **`.loose()` 而非 `.strict()`**：包里新增字段（未来 capability 扩容）不该让旧加载器炸。
 *   zod 默认会剥离未知键，`loose` 保留它们 —— 与 `projectSchemaTolerant` 同一条理由。
 * - **`sections` 允许为空数组**：`ai-manhua-emotion-clip` 的判据属 L1 生成策略而非 L0 判据正本，
 *   其 `rules.json` 的 `sections` 就是空表（打包脚本 `localSections: []` 的诚实标注）。
 *   若在此处卡「至少一节」，这个包会永久装不上。
 *
 * 本文件不引用 `electron` 运行时，可被单元测试直接导入。
 */

/** 当前加载器支持的包协议版本。改动包语义时必须同步 bump，否则旧包会被静默按新语义解释。 */
export const skillApiVersion = '1';

/** 溯源锚的形状：SHA-256 的小写十六进制表示。 */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/u, 'sourceSha256 必须是 64 位小写十六进制');

/** 依赖声明：`version` 支持 `^x.y.z` 这类范围串，加载器只记录不求解（首版单入口，无冲突可能）。 */
export const skillDependencySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
}).loose();

/** 两路供给声明：本包对本地引擎、AI 引擎各供哪些文件。加载器据此挑段，不整包塞给 AI（省 token）。 */
export const skillConsumersSchema = z.object({
  local: z.array(z.string()).default([]),
  ai: z.array(z.string()).default([]),
}).loose();

/** `meta.json` —— 包清单。`sourcePath` 只作溯源记录，**运行时不读**（包内文件自足）。 */
export const skillMetaSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.literal(skillApiVersion),
  domain: z.string().min(1).optional(),
  /** 是否为可见入口。首版唯一入口 = `minimax-h3-video-prompt`，其余为依赖包（界面不单独列出）。 */
  entry: z.boolean().optional(),
  dependencies: z.array(skillDependencySchema).default([]),
  sourceSha256: sha256Hex,
  sourcePath: z.string().optional(),
  sourceHeading: z.string().optional(),
  capabilities: z.array(z.string().min(1)).default([]),
  consumers: skillConsumersSchema.optional(),
}).loose();

/**
 * `catalog.json` 的条目 —— **索引条目，不是完整 manifest**。
 *
 * ⚠️ 它**刻意不含 `apiVersion`**：协议版本由 `catalog.json` 顶层统一声明一次，
 * 逐条目重复既冗余、又给了「顶层与条目各说各话」的机会（顶层闸门已足以拦住不兼容清单）。
 * 同理不含 `sourcePath` / `sourceHeading` / `consumers` —— 那些是 manifest 的溯源与供给声明，
 * 装包时才需要（读 `meta.json`），列进索引只会让索引膨胀。
 *
 * 这个形状由 `scanCatalog` 与 `catalog.json` **共用同一个构造器**产出（`manager.ts` 的
 * `indexEntryOf`），因此「目录清单缺失时扫盘生成」的结果与带清单时**逐字段同构**，
 * 上层无需分辨来源。改这里的字段必须同步改那里，否则两个来源会悄悄分叉。
 */
export const skillCatalogEntrySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  domain: z.string().min(1).optional(),
  entry: z.boolean().optional(),
  dependencies: z.array(skillDependencySchema).default([]),
  sourceSha256: sha256Hex,
  capabilities: z.array(z.string().min(1)).default([]),
  /** 相对 skills 根的落点，一律用 `/` 分隔（跨平台可移植）。 */
  path: z.string().min(1),
}).loose();

/**
 * `catalog.json` 顶层结构。
 *
 * `packages` 只校验「是非空数组」—— 逐条目校验交给调用方（`loadCatalog`），
 * 这样能把**每个**坏包的问题一次收齐再报，而不是撞上第一个就停。
 */
export const skillCatalogSchema = z.object({
  apiVersion: z.literal(skillApiVersion),
  domain: z.string().optional(),
  /** 入口包 id；缺省时加载器取 `packages` 里第一个 `entry: true` 的包。 */
  entry: z.string().optional(),
  packages: z.array(z.unknown()).min(1),
}).loose();

/** `rules.json` 的节：按 `capability` 分节，节内字段随 capability 而异，故只认 `capability`。 */
export const skillRuleSectionSchema = z.object({ capability: z.string().min(1) }).loose();

/** `rules.json` —— 机器读判据。`sections` 可为空（见文件头说明）。 */
export const skillRulesSchema = z.object({
  skillId: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.literal(skillApiVersion),
  sourceSha256: sha256Hex,
  sections: z.array(skillRuleSectionSchema),
}).loose();

export type SkillDependency = z.infer<typeof skillDependencySchema>;
export type SkillConsumers = z.infer<typeof skillConsumersSchema>;
export type SkillMeta = z.infer<typeof skillMetaSchema>;
export type SkillCatalogEntry = z.infer<typeof skillCatalogEntrySchema>;
export type SkillCatalog = z.infer<typeof skillCatalogSchema>;
export type SkillRuleSection = z.infer<typeof skillRuleSectionSchema>;
export type SkillRules = z.infer<typeof skillRulesSchema>;

/**
 * 把 zod 的报错压成一行可读文案。
 *
 * 默认的 `error.message` 是一整段 JSON，装进 IPC 错误或界面提示里没人看得懂；
 * 这里取「路径: 说明」的简写形式，路径用 `(root)` 表示顶层字段缺失。
 */
export function formatIssues(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('；');
  }
  return error instanceof Error ? error.message : String(error);
}
