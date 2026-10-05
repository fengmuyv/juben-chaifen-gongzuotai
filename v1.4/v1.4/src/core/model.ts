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
  /** 生成通道已为该段产出导演决策（规则或 AI）；可选以便旧快照直接解析。 */
  directorGenerated: z.boolean().default(false),
  imageIds: z.array(z.string()).default([]),
});
export type Segment = z.infer<typeof segmentSchema>;

/** 本地图像分析的确定性输出（阶段 C · 本地引擎 A）。 */
export const imageAnalysisSchema = z.object({
  kindGuess: z.enum(['character', 'scene', 'prop']),
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

export const imageSchema = z.object({
  id: z.string(), name: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), dataUrl: z.string().startsWith('data:image/'),
  kind: z.enum(['character', 'scene', 'prop']), description: z.string(), confirmed: z.boolean(), version: z.number().int().positive(),
  matchConfidence: matchConfidenceSchema.optional(), matchSource: matchSourceSchema.optional(), analysis: imageAnalysisSchema.optional(),
});
export type ReferenceImage = z.infer<typeof imageSchema>;

export const sceneSchema = z.object({ id: z.string(), title: z.string(), range: rangeSchema });
export type Scene = z.infer<typeof sceneSchema>;

/** 集：参考图归属于集，不跨集复用；同一集内可跨段复用。 */
export const episodeSchema = z.object({
  id: z.string(), label: z.string().min(1), index: z.number().int().positive(),
  /** 该集文本在整本原稿中的字符范围（校验与重建用，可选以兼容旧存档）。 */
  sourceRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).optional(),
  scenes: z.array(sceneSchema), beats: z.array(beatSchema), segments: z.array(segmentSchema),
  images: z.array(imageSchema).default([]), confirmed: z.boolean().default(false), splitVerified: z.boolean().default(false),
});
export type Episode = z.infer<typeof episodeSchema>;

export const projectSchema = z.object({
  schemaVersion: z.literal(2), id: z.string(), title: z.string().min(1),
  contentType: z.enum(contentTypes), defaultMode: z.enum(['dialogue', 'action', 'combined']),
  platform: z.literal('minimax-h3'), compilerVersion: z.literal('0.2.0'), skeletonVersion: z.literal('1.0.0'),
  scripts: z.array(z.object({ id: z.string(), text: z.string(), filename: z.string() })).min(1), activeScriptId: z.string(),
  episodes: z.array(episodeSchema).min(1), activeEpisodeId: z.string(),
  visual: z.object({ version: z.number().int().positive(), character: z.string(), scene: z.string(), confirmed: z.boolean(), source: z.literal('manual') }),
});
/**
 * 运行时类型：两个「版本指纹」字段刻意放宽为 `string`。
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

export function episodeOfShot(project: Project, shotId: string): Episode | undefined {
  return project.episodes.find((episode) => episode.segments.some((segment) => segment.shots.some((shot) => shot.id === shotId)));
}
