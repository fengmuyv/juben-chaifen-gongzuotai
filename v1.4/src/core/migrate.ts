import { z } from 'zod';
import { beatSchema, contentTypes, imageSchema, projectSchema, sceneSchema, segmentSchema, type Project } from './model';
import { episodeLabel } from './episodes';

/** v1.0 单集快照结构（迁移输入）。 */
export const v1ProjectSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), title: z.string().min(1), episode: z.string().min(1),
  contentType: z.enum(contentTypes), defaultMode: z.enum(['dialogue', 'action', 'combined']),
  platform: z.literal('minimax-h3'), compilerVersion: z.literal('0.1.0'), skeletonVersion: z.literal('1.0.0'),
  scripts: z.array(z.object({ id: z.string(), text: z.string(), filename: z.string() })).min(1), activeScriptId: z.string(),
  scenes: z.array(sceneSchema), beats: z.array(beatSchema), segments: z.array(segmentSchema),
  visual: z.object({ version: z.number().int().positive(), character: z.string(), scene: z.string(), confirmed: z.boolean(), source: z.literal('manual') }),
  images: z.array(imageSchema).default([]),
});
export type V1Project = z.infer<typeof v1ProjectSchema>;

export function parseEpisodeIndex(label: string): number | null {
  const match = /(?:第\s*)?([0-9]{1,4})\s*[集话章]/u.exec(label);
  return match ? Number(match[1]) : null;
}

export type MigrationResult = { project: Project; migrated: boolean };

/**
 * 读取兼容层：**只**放宽两个「版本指纹」字段，其余仍由 `projectSchema` 全量校验。
 *
 * 起因（2026-10-03 定案）：`projectSchema` 是**写入侧正本**，版本号用 `z.literal` 钉死，
 * 而 `compilerVersion` 已经跃迁过一次（v1 的 `0.1.0` → v2 的 `0.2.0`）。若不设兼容层，
 * 将来升到 `0.3.0` 之后，**旧版本程序读自己写过的新存档**会 strict 校验失败 →
 * 落回 `v1ProjectSchema.parse` 分支抛错 → `loadDraft` 静默返回「无存档」，用户数据看似凭空消失。
 *
 * 可放宽的依据：
 * - 这两个字段只被 `word.ts` 打印进 Word 页眉，**不参与任何判定**；
 * - shot 的正文是**具名字段**（scale / composition / lens …）而非数组下标，骨架增删字段不会造成错位读取。
 *
 * `.loose()`（等价 passthrough）是必需的：zod 默认会**剥离**未知键，
 * 那样「更高版本新增的字段」在读入时就被丢掉，用户随后一保存即被永久抹除 —— 等于换一种方式丢数据。
 * 保留未知键后，降级运行再回存的存档仍能被更高版本读回完整内容。
 *
 * **本 schema 只用于读取**；写入侧一律 `projectSchema`，不得用它旁路校验。
 */
export const projectSchemaTolerant = projectSchema.extend({
  compilerVersion: z.string(), skeletonVersion: z.string(),
}).loose();

/**
 * 任意历史快照 → v2 项目。v1 单集快照自动包装为仅含一集的 v2 结构，旧存档不失效。
 */
export function migrateProject(raw: unknown): MigrationResult {
  const current = projectSchema.safeParse(raw);
  if (current.success) return { project: current.data, migrated: false };
  /**
   * 第二跳：v2 结构完整、只有版本指纹不同（跨版本回读）。
   * **不得**落回 v1 分支 —— 那会抛错并被 `loadDraft` 吞掉，表现为存档静默丢失。
   * 返回 `migrated: false`：这不是 v1→v2 迁移，不能触发「已从 v1.0 单集存档自动迁移」的提示，也无需回写。
   */
  const tolerant = projectSchemaTolerant.safeParse(raw);
  if (tolerant.success) return { project: tolerant.data, migrated: false };
  const legacy = v1ProjectSchema.parse(raw);
  const index = parseEpisodeIndex(legacy.episode) ?? 1;
  const project = projectSchema.parse({
    schemaVersion: 2, id: legacy.id, title: legacy.title,
    contentType: legacy.contentType, defaultMode: legacy.defaultMode,
    platform: 'minimax-h3', compilerVersion: '0.2.0', skeletonVersion: '1.0.0',
    scripts: legacy.scripts, activeScriptId: legacy.activeScriptId,
    episodes: [{
      id: 'ep-01', label: episodeLabel(index), index,
      scenes: legacy.scenes, beats: legacy.beats, segments: legacy.segments, images: legacy.images,
      confirmed: legacy.segments.every((segment) => segment.confirmed), splitVerified: true,
    }],
    activeEpisodeId: 'ep-01', visual: legacy.visual,
  });
  return { project, migrated: true };
}
