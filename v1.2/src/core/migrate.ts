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
 * 任意历史快照 → v2 项目。v1 单集快照自动包装为仅含一集的 v2 结构，旧存档不失效。
 */
export function migrateProject(raw: unknown): MigrationResult {
  const current = projectSchema.safeParse(raw);
  if (current.success) return { project: current.data, migrated: false };
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
