import { z } from 'zod';

export const contentTypes = ['short-drama', 'mid-drama', 'long-drama', 'film'] as const;
export const modeSchema = z.enum(['dialogue', 'action']);
export type Mode = z.infer<typeof modeSchema>;
export type DefaultMode = Mode | 'combined';

/** 条目来源：本地规则引擎 / AI 增强通道 / 人工填写。 */
export const draftSourceSchema = z.enum(['local', 'ai', 'manual']);
export type DraftSource = z.infer<typeof draftSourceSchema>;

/** 参考图自动匹配的三级置信度。 */
export const matchConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type MatchConfidence = z.infer<typeof matchConfidenceSchema>;

/** 匹配依据：文件名 / 路径关键词 / 视觉模型 / 人工。 */
export const matchSourceSchema = z.enum(['name', 'path', 'vision', 'manual']);
export type MatchSource = z.infer<typeof matchSourceSchema>;

const rangeSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
export const fragmentKindSchema = z.enum(['dialogue', 'inner', 'narration']).default('dialogue');
const fragmentSchema = z.object({ speaker: z.string(), text: z.string(), range: rangeSchema, kind: fragmentKindSchema });
export type Dialogue = z.infer<typeof fragmentSchema>;

export const beatSchema = z.object({ id: z.string(), sceneId: z.string(), kind: z.enum(['dialogue', 'action']), text: z.string(), range: rangeSchema, dialogue: fragmentSchema.optional() });
export type Beat = z.infer<typeof beatSchema>;

export const shotSchema = z.object({
  id: z.string(), duration: z.number().positive(), beatIds: z.array(z.string()), dialogue: z.array(fragmentSchema),
  purpose: z.string(), scale: z.string(), composition: z.string(), lens: z.string(), movement: z.string(),
  light: z.string(), atmosphere: z.string(), blocking: z.string(), action: z.string(), performance: z.string(),
  sound: z.string(), transition: z.string(), locked: z.boolean(),
  draftSource: draftSourceSchema.optional(),
});
export type Shot = z.infer<typeof shotSchema>;

export const segmentSchema = z.object({
  id: z.string(), sceneId: z.string(), mode: modeSchema, duration: z.number().positive(), beatIds: z.array(z.string()), shots: z.array(shotSchema),
  /** 人工确认：建议复核项，不阻断导出。 */
  confirmed: z.boolean(),
  /**
   * 生成通道已为该段产出导演决策（规则或 AI）；`.default` 让其可被旧快照直接解析。
   * **读写都走 `isSegmentGenerated()`** —— 它是「本段至少有一镜真被写过」的派生投影，
   * 该字段只是它的落盘副本，任何判定都不得直接读这里的值。
   */
  directorGenerated: z.boolean().default(false),
  imageIds: z.array(z.string()).default([]),
});
export type Segment = z.infer<typeof segmentSchema>;

/** 本地图像分析的确定性输出（阶段 C · 本地引擎 A）。 */
export const imageAnalysisSchema = z.object({
  /**
   * **按文件名猜的**图类，只作界面提示、**不参与匹配**（裁决以用户导入时所选分类为准）。
   *
   * 2026-10-06「道具」图类退役后收成两类，并**允许 `null`**：
   * 原来的兜底是「判不出就保守判为道具」——那道兜底的全部意义就是「让它不自动匹配」。
   * 道具没了之后，把判不出的图硬塞进「人物」或「场景」都会让它**误入自动匹配**，
   * 于是兜底改为 `null`（判不出就是判不出，不猜）。
   */
  kindGuess: z.enum(['character', 'scene']).nullable(),
  kindReason: z.string(),
  subject: z.string().nullable(),
  subjectConfidence: matchConfidenceSchema,
  dominant: z.array(z.string()).default([]),
  brightness: z.number().min(0).max(1),
  saturation: z.number().min(0).max(1),
  temperature: z.enum(['warm', 'neutral', 'cool']),
  lightDirection: z.enum(['top', 'left', 'right', 'bottom', 'flat']),
  indoor: z.enum(['indoor', 'outdoor', 'unknown']),
});
export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;

/**
 * 资产（参考图）本体：**与集无关**。
 *
 * 2026-10-05 起资产归 **项目级资产库**（`projectSchema.assets`），一张图只存一份；
 * 匹配结论（置信度 / 来源）是「集 × 资产」的关系，因此**不在资产上**记录，改由
 * `episodeSchema.imageMatches` 逐集记账 —— 否则同一张图在 A 集是 high、在 B 集是 low 时，
 * 资产上的单一字段必然说谎，且匹配 A 集会污染 B 集的界面与校验。
 *
 * **可用性判据 = `description` 非空**（2026-10-05 老大裁定取消人工确认）：
 * 原先填了描述还要再点一次「确认描述」，才被 ① ② ④ 与校验认作可用；两类资产
 * （人物 / 场景）一律**填了描述即生效**，`confirmed` 字段已从模型移除。
 * 旧存档里残留的 `confirmed` 键由 zod 读取时剥离（不报错、不牵动其他字段）。
 *
 * **「道具」图类已于 2026-10-06 退役**（老大「道具选区不要了」）：写入侧只认两类。
 * 老存档里的道具资产由 `migrate.ts` 的 `retirePropAssets` 在解析**之前**丢弃 ——
 * 不先丢就会因这条窄化的 enum 解析失败，进而被 `loadDraft` 吞掉，表现为**整份存档静默消失**。
 */
export const imageSchema = z.object({
  id: z.string(), name: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), dataUrl: z.string().startsWith('data:image/'),
  kind: z.enum(['character', 'scene']), description: z.string(), version: z.number().int().positive(),
  analysis: imageAnalysisSchema.optional(),
});
export type ReferenceImage = z.infer<typeof imageSchema>;

/** 单张资产在**某一集**里的匹配结论（key = 资产 id）。 */
export const imageMatchSchema = z.object({ confidence: matchConfidenceSchema, source: matchSourceSchema });
export type ImageMatch = z.infer<typeof imageMatchSchema>;

export const sceneSchema = z.object({ id: z.string(), title: z.string(), range: rangeSchema });
export type Scene = z.infer<typeof sceneSchema>;

/** 集：只记录「本集把哪些资产绑到了哪些段」与匹配结论；资产本体在项目级资产库里。 */
export const episodeSchema = z.object({
  id: z.string(), label: z.string().min(1), index: z.number().int().positive(),
  /** 该集文本在整本原稿中的字符范围（校验与重建用，可选以兼容旧存档）。 */
  sourceRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).optional(),
  scenes: z.array(sceneSchema), beats: z.array(beatSchema), segments: z.array(segmentSchema),
  /** 本集匹配结论：资产 id → 置信度 / 依据。空对象表示本集尚未做过匹配。 */
  imageMatches: z.record(z.string(), imageMatchSchema).default({}),
  confirmed: z.boolean().default(false), splitVerified: z.boolean().default(false),
});
export type Episode = z.infer<typeof episodeSchema>;

export const projectSchema = z.object({
  schemaVersion: z.literal(2), id: z.string(), title: z.string().min(1),
  contentType: z.enum(contentTypes), defaultMode: z.enum(['dialogue', 'action', 'combined']),
  platform: z.literal('minimax-h3'), compilerVersion: z.literal('0.2.0'), skeletonVersion: z.literal('1.0.0'),
  /**
   * 解析契约版本（分集与正文识别口径的指纹，见 `parser.parserVersion`）。
   *
   * **可选**：v2 之前的存档、以及 v1 迁移来的项目都没有此字段 → 读到 `undefined`，
   * 由 `reconcileSplit` 判定为「旧口径」并重建/提示。刻意不用 `z.literal` 钉死：
   * 那样读旧存档会 strict 失败，而 `projectSchema` 是写入侧正本，不该为读取方便放宽 ——
   * 用可选字段表达「历史存档可以没有它」比事后补兼容分支干净。
   */
  parserVersion: z.string().optional(),
  scripts: z.array(z.object({ id: z.string(), text: z.string(), filename: z.string() })).min(1), activeScriptId: z.string(),
  /**
   * 全项目**资产库**（人物 / 场景）：单一来源。
   * 用户一次性把所有资产导入这里，各集生成时按名册（人物名 / 场景名）与剧情自动选配到段 ——
   * 资产不隶属任何一集，也不重复存储。（「道具」图类已于 2026-10-06 退役。）
   */
  assets: z.array(imageSchema).default([]),
  episodes: z.array(episodeSchema).min(1), activeEpisodeId: z.string(),
  visual: z.object({
    version: z.number().int().positive(), character: z.string(), scene: z.string(), confirmed: z.boolean(), source: z.literal('manual'),
    /**
     * **按人物**的「人物设定 / 人物弧光」（2026-10-06 老大裁定：界面按已上传的**人物资产**自动列出人物，
     * 每人两个文本框；全本一份、不随集切换；本轮**先只落盘**，不接进生成链路）。
     *
     * 与上面三个字段的分工必须分清，否则很容易顺手写错：
     * - `character` / `scene` 是**整本一段**的固定锚点（字符串），`version` / `confirmed` 描述的是它；
     * - `cast` 是**按人物**的条目，改它**不得**动 `version` / `confirmed`（那是锚点的确认状态，不是文本的）。
     *
     * `name` 取自人物资产的文件名（去扩展名）—— 也就是说它**不是**第二份人物名册：
     * 身份仍由资产（与剧本名册）派生，这里只按名字挂一段文本；资产删了条目留着（不静默丢用户劳动），
     * 重新导入同名图即回来。因此本数组允许存在「当前资产里没有对应人物」的条目，界面不显示它们即可。
     *
     * `default([])` 是给老存档用的：v2 早期快照没有这把键，缺省补空数组，
     * **不需要**任何迁移分支（与 `assets` 同一手法）。
     */
    cast: z.array(z.object({ name: z.string(), setting: z.string(), arc: z.string() })).default([]),
  }),
});
/**
 * 运行时类型：两个「版本指纹」字段刻意放宽为 `string`（`parserVersion` 本就是可选 string，无需放宽）。
 *
 * `projectSchema` 是**写入侧正本**，必须钉死当前版本号（`z.literal`）；
 * 但**读取**侧要能接住「更高版本写出的存档」（见 `migrate.ts` 的 `projectSchemaTolerant`），
 * 因此运行时对象里的版本号完全可能是别的值。让类型说实话，好过在读取侧到处写断言。
 */
export type Project = Omit<z.infer<typeof projectSchema>, 'compilerVersion' | 'skeletonVersion'> & {
  compilerVersion: string; skeletonVersion: string;
};

/** 问题分类：事实类（input / reference / source）与内容安全（safety）继续阻断，review 为建议复核。 */
export type IssueCategory = 'input' | 'reference' | 'source' | 'safety' | 'review';
export type Issue = { code: string; severity: 'error' | 'warning'; category: IssueCategory; message: string; segmentId?: string; shotId?: string };

export function activeScript(project: Project) {
  const script = project.scripts.find((item) => item.id === project.activeScriptId);
  if (!script) throw new Error('原稿版本引用不存在');
  return script;
}

export function activeEpisode(project: Project): Episode {
  const episode = project.episodes.find((item) => item.id === project.activeEpisodeId);
  return episode ?? project.episodes[0];
}

/**
 * 本集对应的**原稿原文**（`sourceRange` 切片）。
 *
 * 单一来源：校验（`validator`）、重建（`repair`）、AI 上下文取材（`App`）都取这一处 ——
 * 三份各自 `slice` 会漂移（尤其 `sourceRange` 缺失时的回落口径）。
 * `sourceRange` 只在一本一集时缺省，此时整篇即本集；多集而缺 `sourceRange` 时无从归属，回 `null`。
 */
export function episodeSource(project: Project, episode: Episode): string | null {
  const text = activeScript(project).text;
  if (episode.sourceRange) return text.slice(episode.sourceRange.start, episode.sourceRange.end);
  return project.episodes.length === 1 ? text : null;
}

export function episodeOfShot(project: Project, shotId: string): Episode | undefined {
  return project.episodes.find((episode) => episode.segments.some((segment) => segment.shots.some((shot) => shot.id === shotId)));
}

/**
 * 本集**已绑定**的资产：段上 `imageIds` → 项目资产库查表。
 * 资产库是单源，本集视图只是「项目库 ∩ 本集绑定」的投影，不另存副本。
 */
export function episodeBoundAssets(project: Project, episode: Episode): ReferenceImage[] {
  const bound = new Set(episode.segments.flatMap((segment) => segment.imageIds));
  return project.assets.filter((image) => bound.has(image.id));
}

/**
 * 导出 / 预览的**片段范围**：不给 `segmentId` 即整集；给了就只取那一段（P ≡ 15 秒一段）。
 *
 * 单源理由：Word 导出（`core/word.ts`）与文本预览（`platforms/minimax-h3/compiler.ts`）
 * 是两条独立的输出链路，但「片段是什么」只能有一个答案 —— 各写一遍过滤，早晚出现
 * 「Word 导一片、TXT 导整集」这种谁也说不清的错位。
 *
 * 段号不存在时**抛错，不静默回退整集**：回退会让用户以为导出了一片，实际拿到整集；
 * 而导出只有标题的空文档更糟 —— 两者都是本项目明令反对的静默失败。
 */
export function segmentsOf(episode: Episode, segmentId?: string): Episode['segments'] {
  if (!segmentId) return episode.segments;
  const scoped = episode.segments.filter((item) => item.id === segmentId);
  if (!scoped.length) throw new Error(`片段 ${segmentId} 不存在，无法导出`);
  return scoped;
}

/**
 * 段级「导演决策已生成」的**唯一判据**（派生，以 `Segment.directorGenerated` 这个存量字段的写入值为投影）。
 *
 * 判据 = 本段**至少有一镜真的被写过** —— 该镜带 `draftSource`（本地规则 / AI / 人工三态在真正写入字段时都会打标，
 * 见 `store.mergeDrafts` 的 `if (shotFilled === 0) return shot` 之后那一行）。
 *
 * 为什么必须是「派生」而不是「被生成动作扫过即为真」：AI 依次推理是**一段一段**来的，还没轮到的那一段
 * 板上本就该是空白；而回填层此前的 `const marked = true` 把「扫过」等同于「生成」，于是只要发生过一次
 * 整集导出（`prepareForExport` 会对整集每一段跑规则生成）或一次一键生成，整集每段都挂上「已生成」，
 * 与「这一段到底有没有产出」无关（老大 2026-10-06 截图：没推理到的 P01–P14 全亮）。
 *
 * 读这一处的五方（不得各自判断）：`store.mergeDrafts`（回填后重算并落盘）、`repair.repairEpisode`（重建后重算）、
 * `validator`（复核文案）、`planner.hasUserContent`（该段是否已属用户内容）、导演板（已生成标与计数）。
 */
export function isSegmentGenerated(segment: Segment): boolean {
  return segment.shots.some((shot) => !!shot.draftSource);
}

/**
 * 「人物设定与弧光」的人物列表来源（2026-10-06 老大裁定「只检测资产的人物名称」）：
 * 已上传的**人物资产**文件名去扩展名，按导入顺序去重。
 *
 * **只读派生** —— 这里刻意不新存一份人物名册（§5.4 铁律 1：两侧不得各存人物实体），
 * 所以它也不做「`_正面` / `_侧`」这类后缀清洗：那是按见过的样本猜词，会误伤真名。
 * 名字不理想就改资产文件名 —— 文件名是这条链上唯一的输入。
 */
export function castNamesOf(assets: ReferenceImage[]): string[] {
  const names: string[] = [];
  for (const image of assets) {
    if (image.kind !== 'character') continue;
    const stem = image.name.replace(/\.[^.]+$/u, '').trim();
    if (stem && !names.includes(stem)) names.push(stem);
  }
  return names;
}
