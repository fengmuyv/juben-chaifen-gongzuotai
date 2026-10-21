import { z } from 'zod';
import { beatSchema, contentTypes, imageSchema, matchConfidenceSchema, matchSourceSchema, projectSchema, sceneSchema, segmentSchema, type Project } from './model';
import { episodeLabel } from './episodes';

/**
 * 旧资产形态（参考图挂在集上）：比资产本体多两个匹配字段。
 * 只用于**读取**历史存档，写入侧仍是 `imageSchema`。
 */
const legacyImageSchema = imageSchema.extend({
  matchConfidence: matchConfidenceSchema.optional(), matchSource: matchSourceSchema.optional(),
});

/** v1.0 单集快照结构（迁移输入）。 */
export const v1ProjectSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), title: z.string().min(1), episode: z.string().min(1),
  contentType: z.enum(contentTypes), defaultMode: z.enum(['dialogue', 'action', 'combined']),
  platform: z.literal('minimax-h3'), compilerVersion: z.literal('0.1.0'), skeletonVersion: z.literal('1.0.0'),
  scripts: z.array(z.object({ id: z.string(), text: z.string(), filename: z.string() })).min(1), activeScriptId: z.string(),
  scenes: z.array(sceneSchema), beats: z.array(beatSchema), segments: z.array(segmentSchema),
  visual: z.object({ version: z.number().int().positive(), character: z.string(), scene: z.string(), confirmed: z.boolean(), source: z.literal('manual') }),
  images: z.array(legacyImageSchema).default([]),
});
export type V1Project = z.infer<typeof v1ProjectSchema>;

export function parseEpisodeIndex(label: string): number | null {
  const match = /(?:第\s*)?([0-9]{1,4})\s*[集话章]/u.exec(label);
  return match ? Number(match[1]) : null;
}

type LegacyImage = z.infer<typeof legacyImageSchema>;

/** 剥掉已退休的匹配字段：写回资产库的一律是纯资产本体。 */
function toAsset(image: LegacyImage): Omit<LegacyImage, 'matchConfidence' | 'matchSource'> {
  const { matchConfidence: _confidence, matchSource: _source, ...asset } = image;
  return asset;
}

/** 同一张图在多集里都存过时，保留信息更全的那一份（有描述 > 版本号高）。 */
function richer(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const described = (item: Record<string, unknown>) => String(item.description ?? '').trim().length;
  if (described(b) !== described(a)) return described(b) > described(a) ? b : a;
  return Number(b.version ?? 0) > Number(a.version ?? 0) ? b : a;
}

/**
 * 旧存档 → 新资产形态（**读取侧**归一化，先于 schema 解析执行）。
 *
 * 起因（2026-10-05）：参考图此前挂在 `episode.images` 上，资产不通用 ——
 * 换一集就得重新导入一遍。改为项目级资产库后，**已存存档里那份按集存放的图必须搬过来**：
 * zod 默认会剥离未知键，若不先搬就解析，整本参考图会被静默抹掉（再一保存即永久丢失）。
 *
 * 搬迁规则：
 * - 逐集收集 `images`，按 id 去重进 `assets`（同 id 取信息更全的一份）；
 * - 每集的 `images[].matchConfidence / matchSource` 就地转成本集 `imageMatches[id]` ——
 *   匹配结论本来就是「集 × 资产」的关系，搬迁后语义不变；
 * - `segment.imageIds` 不动（资产 id 全局唯一，绑定关系照旧有效）。
 *
 * 幂等：已是新形态（无 `episodes[].images`）时原样返回，不做任何改动。
 */
export function hoistEpisodeImages(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const carrier = raw as { assets?: unknown[]; episodes?: unknown[] };
  if (!Array.isArray(carrier.episodes)) return raw;
  const legacyEpisodes = carrier.episodes.filter((episode): episode is Record<string, unknown> => !!episode && typeof episode === 'object');
  if (!legacyEpisodes.some((episode) => Array.isArray(episode.images))) return raw;

  const assets: Record<string, unknown>[] = Array.isArray(carrier.assets) ? (carrier.assets as Record<string, unknown>[]) : [];
  const byId = new Map<string, Record<string, unknown>>(assets.map((asset) => [String(asset.id), asset]));
  const episodes = carrier.episodes.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const episode = entry as Record<string, unknown>;
    if (!Array.isArray(episode.images)) return episode;
    const matches: Record<string, { confidence: string; source: string }> = { ...(episode.imageMatches as Record<string, { confidence: string; source: string }> | undefined) };
    for (const item of episode.images as LegacyImage[]) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id);
      const mine = toAsset(item) as Record<string, unknown>;
      const existing = byId.get(id);
      if (!existing) { byId.set(id, mine); assets.push(mine); }
      else {
        const better = richer(existing, mine);
        if (better !== existing) { byId.set(id, better); assets[assets.indexOf(existing)] = better; }
      }
      if (item.matchConfidence) matches[id] = { confidence: item.matchConfidence, source: item.matchSource ?? 'name' };
    }
    const { images: _moved, ...rest } = episode;
    return { ...rest, imageMatches: matches };
  });
  return { ...carrier, assets, episodes };
}

export type MigrationResult = { project: Project; migrated: boolean; droppedPropImages: number };

/**
 * 「道具」图类退役（2026-10-06 老大裁定「连数据层一起退役」）：在 schema 解析**之前**摘掉老存档里的道具资产。
 *
 * **为什么必须在解析前**：`imageSchema.kind` 已窄化成两类，`projectSchema` 与
 * `projectSchemaTolerant` 都继承了它 —— 老存档里只要有一张 `kind:'prop'` 的图，两跳都会 strict 失败，
 * 落回 `v1ProjectSchema` 再抛错，最终被 `loadDraft` 吞成「没有存档」。用户看到的不是报错，
 * 而是**整份存档凭空消失**。（这条正是 `projectSchemaTolerant` 存在的理由，只是它治不了「结构性」失配。）
 *
 * **处置 = 直接丢弃**（老大原话「直接丢弃」，已明示不可撤销）。丢弃本身必须配套三件事，
 * 否则会留下坏引用：① 从 `assets` 摘掉；② 清掉各集 `segment.imageIds` 与 `episode.imageMatches`
 * 里的悬挂引用（不清的话「本段 N/6」会数到已经不在库里的图）；③ `analysis.kindGuess` 的历史值
 * `'prop'` 归一为 `null`（判定兜底已改为「判不出就是 null」，硬塞成人物或场景会让它误入自动匹配）。
 *
 * 返回值带出**丢弃张数**，由载入侧可见地告知用户 —— 按裁定可以丢，但不许**静默**丢。
 *
 * 幂等：没有道具资产、也没有待归一的 kindGuess 时原样返回（`raw` 引用不变），不产生无谓改写。
 */
export function retirePropAssets(raw: unknown): { raw: unknown; dropped: number } {
  if (!raw || typeof raw !== 'object') return { raw, dropped: 0 };
  const carrier = raw as Record<string, unknown>;
  const removed = new Set<string>();
  let normalized = 0;

  /** 逐条过滤：道具摘掉并记 id；其余把 `kindGuess:'prop'` 归一为 null。 */
  const filterList = (list: unknown[]): unknown[] => list.flatMap((item) => {
    if (!item || typeof item !== 'object') return [item];
    const entry = item as Record<string, unknown>;
    if (entry.kind === 'prop') { removed.add(String(entry.id)); return []; }
    const analysis = entry.analysis;
    if (analysis && typeof analysis === 'object' && (analysis as Record<string, unknown>).kindGuess === 'prop') {
      normalized += 1;
      return [{ ...entry, analysis: { ...(analysis as Record<string, unknown>), kindGuess: null } }];
    }
    return [item];
  });

  const assets = Array.isArray(carrier.assets) ? filterList(carrier.assets) : carrier.assets;
  // v1 单集快照的参考图挂在**项目根**的 `images` 上（此时还没被 hoist 成 `assets`），须一并处理。
  const images = Array.isArray(carrier.images) ? filterList(carrier.images) : carrier.images;
  if (!removed.size && !normalized) return { raw, dropped: 0 };

  /** 清掉段上的悬挂绑定（被丢掉的图 id）；一个都没命中时原样返回，避免无谓改写。 */
  const cleanSegments = (segments: unknown): unknown => {
    if (!Array.isArray(segments)) return segments;
    return segments.map((segment) => {
      if (!segment || typeof segment !== 'object') return segment;
      const item = segment as Record<string, unknown>;
      if (!Array.isArray(item.imageIds)) return segment;
      const kept = (item.imageIds as unknown[]).filter((id) => !removed.has(String(id)));
      return kept.length === (item.imageIds as unknown[]).length ? segment : { ...item, imageIds: kept };
    });
  };

  const episodes = Array.isArray(carrier.episodes) ? carrier.episodes.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const episode = entry as Record<string, unknown>;
    const matches = { ...(episode.imageMatches as Record<string, unknown> | undefined) };
    for (const id of removed) delete matches[id];
    return { ...episode, imageMatches: matches, segments: cleanSegments(episode.segments) };
  }) : carrier.episodes;
  // v1 单集快照的段也挂在**项目根**（`legacy.segments`），段上同样可能有指向道具图的绑定。
  const legacySegments = cleanSegments(carrier.segments);

  /**
   * 只写回**原本就有**的那几把键。凭空补一个 `undefined` 不只是冗余：`projectSchemaTolerant` 是
   * `.loose()`（保留未知键），多出来的空键会跟着回存进存档；而 v1 分支会对多出来的键做未知键处理，
   * 平白增加一层需要解释的行为。
   */
  const next: Record<string, unknown> = { ...carrier };
  if ('assets' in carrier) next.assets = assets;
  if ('images' in carrier) next.images = images;
  if ('episodes' in carrier) next.episodes = episodes;
  if ('segments' in carrier) next.segments = legacySegments;
  return { raw: next, dropped: removed.size };
}

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
 *
 * **先归一化再解析**（两步，顺序不可颠倒）：
 * ① `hoistEpisodeImages` 把旧存档里按集存放的参考图搬进项目资产库，
 *    否则 strict 解析会把 `episode.images` 当未知键剥掉（读入即丢、再保存即永久抹除）；
 * ② `retirePropAssets` 摘掉已退役的「道具」资产并清理悬挂引用，否则窄化后的 enum 会让整份存档读不进来。
 */
export function migrateProject(raw: unknown): MigrationResult {
  const retired = retirePropAssets(hoistEpisodeImages(raw));
  const normalized = retired.raw;
  const current = projectSchema.safeParse(normalized);
  if (current.success) return { project: current.data, migrated: false, droppedPropImages: retired.dropped };
  /**
   * 第二跳：v2 结构完整、只有版本指纹不同（跨版本回读）。
   * **不得**落回 v1 分支 —— 那会抛错并被 `loadDraft` 吞掉，表现为存档静默丢失。
   * 返回 `migrated: false`：这不是 v1→v2 迁移，不能触发「已从 v1.0 单集存档自动迁移」的提示，也无需回写。
   */
  const tolerant = projectSchemaTolerant.safeParse(normalized);
  if (tolerant.success) return { project: tolerant.data, migrated: false, droppedPropImages: retired.dropped };
  const legacy = v1ProjectSchema.parse(normalized);
  const index = parseEpisodeIndex(legacy.episode) ?? 1;
  /** v1 的参考图整体挂在项目根上：全部进资产库，逐图匹配结论记到那唯一一集上。 */
  const imageMatches = Object.fromEntries(legacy.images
    .filter((image) => image.matchConfidence)
    .map((image) => [image.id, { confidence: image.matchConfidence!, source: image.matchSource ?? 'name' as const }]));
  const project = projectSchema.parse({
    schemaVersion: 2, id: legacy.id, title: legacy.title,
    contentType: legacy.contentType, defaultMode: legacy.defaultMode,
    platform: 'minimax-h3', compilerVersion: '0.2.0', skeletonVersion: '1.0.0',
    scripts: legacy.scripts, activeScriptId: legacy.activeScriptId,
    assets: legacy.images.map((image) => toAsset(image)),
    episodes: [{
      id: 'ep-01', label: episodeLabel(index), index,
      scenes: legacy.scenes, beats: legacy.beats, segments: legacy.segments, imageMatches,
      confirmed: legacy.segments.every((segment) => segment.confirmed), splitVerified: true,
    }],
    activeEpisodeId: 'ep-01', visual: legacy.visual,
  });
  return { project, migrated: true, droppedPropImages: retired.dropped };
}
