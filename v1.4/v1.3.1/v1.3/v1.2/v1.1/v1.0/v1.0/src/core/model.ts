import { z } from 'zod';

export const contentTypes = ['short-drama', 'mid-drama', 'long-drama', 'film'] as const;
export const modeSchema = z.enum(['dialogue', 'action']);
export type Mode = z.infer<typeof modeSchema>;
export type DefaultMode = Mode | 'combined';
const rangeSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
const fragmentSchema = z.object({ speaker: z.string(), text: z.string(), range: rangeSchema });
export type Dialogue = z.infer<typeof fragmentSchema>;
const beatSchema = z.object({ id: z.string(), sceneId: z.string(), kind: z.enum(['dialogue', 'action']), text: z.string(), range: rangeSchema, dialogue: fragmentSchema.optional() });
export type Beat = z.infer<typeof beatSchema>;
const shotSchema = z.object({
  id: z.string(), duration: z.number().positive(), beatIds: z.array(z.string()), dialogue: z.array(fragmentSchema),
  purpose: z.string(), scale: z.string(), composition: z.string(), lens: z.string(), movement: z.string(),
  light: z.string(), atmosphere: z.string(), blocking: z.string(), action: z.string(), performance: z.string(),
  sound: z.string(), transition: z.string(), locked: z.boolean(),
});
export type Shot = z.infer<typeof shotSchema>;
const segmentSchema = z.object({ id: z.string(), sceneId: z.string(), mode: modeSchema, duration: z.number().positive(), beatIds: z.array(z.string()), shots: z.array(shotSchema), confirmed: z.boolean() });
export type Segment = z.infer<typeof segmentSchema>;
export const projectSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), title: z.string().min(1), episode: z.string().min(1),
  contentType: z.enum(contentTypes), defaultMode: z.enum(['dialogue', 'action', 'combined']),
  platform: z.literal('minimax-h3'), compilerVersion: z.literal('0.1.0'), skeletonVersion: z.literal('1.0.0'),
  scripts: z.array(z.object({ id: z.string(), text: z.string(), filename: z.string() })).min(1), activeScriptId: z.string(),
  scenes: z.array(z.object({ id: z.string(), title: z.string(), range: rangeSchema })), beats: z.array(beatSchema), segments: z.array(segmentSchema),
  visual: z.object({ version: z.number().int().positive(), character: z.string(), scene: z.string(), confirmed: z.boolean(), source: z.literal('manual') }),
});
export type Project = z.infer<typeof projectSchema>;
export type Issue = { code: string; severity: 'error' | 'warning'; message: string; segmentId?: string; shotId?: string };
export function activeScript(project: Project) {
  const script = project.scripts.find((item) => item.id === project.activeScriptId);
  if (!script) throw new Error('原稿版本引用不存在');
  return script;
}
