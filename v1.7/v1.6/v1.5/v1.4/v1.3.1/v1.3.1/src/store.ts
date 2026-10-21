import { create } from 'zustand';
import { activeEpisode, type DefaultMode, type DraftSource, type Episode, type MatchConfidence, type MatchSource, type Project, type ReferenceImage, type Shot } from './core/model';
import { migrateProject } from './core/migrate';
import { createProject, planProject } from './core/planner';
import { clearDraft, loadDraft, saveDraft } from './core/storage';
import type { EditableShotKey } from './platforms/minimax-h3/skeleton';
import { compositionContradictsStaging, sourceFieldsForShot, type ShotDraft } from './platforms/minimax-h3/director';

export type MatchAssignment = { imageId: string; segmentIds: string[]; confidence: MatchConfidence; source: MatchSource; reason: string };
export type { ShotDraft };

/** 生成批次：一集一组，携带该集的匹配结果与逐段草稿；整批一次写入，避免整本逐集逐段落盘。 */
export type GenerationBatchEntry = {
  episodeId: string;
  assignments?: MatchAssignment[];
  drafts?: { segmentId: string; drafts: ShotDraft[] }[];
};
export type GenerationOptions = { overwrite: boolean; source: DraftSource; replaceMatches?: boolean };
export type GenerationResult = { filled: number; segments: number };

type State = {
  project: Project | null; selectedSegment: string | null; selectedShot: string | null;
  autosaveError: boolean; storageReady: boolean; migrated: boolean; storage: 'indexeddb' | 'localstorage' | 'none';
  hydrate(): Promise<void>;
  clearWorkspace(): Promise<void>;
  setProject(project: Project, focus?: boolean): void;
  importScript(text: string, filename: string): void;
  updateScript(text: string): void; replan(): void; setMode(mode: DefaultMode): void;
  selectEpisode(id: string): void; verifySplit(): void;
  /** 原子跳转：切集并选中指定段与镜，供阻断清单与问题面板定位使用。 */
  focusTarget(episodeId: string, segmentId?: string | null, shotId?: string | null): void;
  setSegmentMode(id: string, mode: 'dialogue' | 'action'): void; selectSegment(id: string): void; selectShot(id: string): void;
  updateVisual(key: 'character' | 'scene', value: string): void; confirmVisual(): void;
  addImage(image: ReferenceImage): void; addImages(images: ReferenceImage[]): { added: number; duplicates: number };
  updateImage(id: string, description: string): void; confirmImage(id: string): void;
  toggleImage(segmentId: string, imageId: string): boolean;
  applyMatch(assignments: MatchAssignment[], options?: { replace?: boolean }, episodeId?: string): void;
  /** 生成通道的唯一写入口：匹配回填 + 逐段回填 + 标记「导演决策已生成」，整批一次 set/persist。 */
  applyGenerationBatch(entries: GenerationBatchEntry[], options: GenerationOptions): GenerationResult;
  applyGenerated(segmentId: string, drafts: ShotDraft[], options: { overwrite: boolean; source: DraftSource }): number;
  updateShot(id: string, key: EditableShotKey | 'duration' | 'purpose', value: string | number): void;
  confirmSegment(id: string): void;
};

/** 自动存档合并窗口（毫秒）：窗口内的多次改动只落盘最后一次。 */
export const autosaveDelay = 300;

let pendingProject: Project | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

/** 立即把待写入的快照落盘；并发调用按写入队列串行执行，不丢最后一次改动。 */
export function flushPersist(): Promise<void> {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  const snapshot = pendingProject;
  if (!snapshot) return writing;
  pendingProject = null;
  writing = writing
    .then(() => saveDraft(snapshot))
    .then(() => { useWorkbench.setState({ autosaveError: false }); })
    .catch(() => { useWorkbench.setState({ autosaveError: true }); });
  return writing;
}

/**
 * 合并写入：状态变更可能每秒发生几十次（一键生成逐段回填、逐键编辑），
 * 而快照含内嵌参考图可达数 MB，逐次整份写穿 IndexedDB 会拖死主线程。窗口内只保留最后一份。
 */
function persist(project: Project) {
  pendingProject = project;
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => { pendingTimer = null; void flushPersist(); }, autosaveDelay);
}

function withEpisode(project: Project, episodeId: string, mutate: (episode: Episode) => Episode): Project {
  return { ...project, episodes: project.episodes.map((episode) => (episode.id === episodeId ? mutate(episode) : episode)) };
}

function mutateSegmentImages(project: Project, segmentId: string, mutate: (segment: Episode['segments'][number]) => Episode['segments'][number] | null): Project {
  return { ...project, episodes: project.episodes.map((episode) => {
    if (!episode.segments.some((segment) => segment.id === segmentId)) return episode;
    const next = mutate(episode.segments.find((segment) => segment.id === segmentId)!);
    if (!next) return episode;
    return { ...episode, segments: episode.segments.map((segment) => (segment.id === segmentId ? next : segment)) };
  }) };
}

function focus(project: Project) {
  const episode = activeEpisode(project);
  return { selectedSegment: episode.segments[0]?.id ?? null, selectedShot: episode.segments[0]?.shots[0]?.id ?? null };
}

/** 匹配结果回填：只更新真正发生变化的图片与段落，未变化的对象保持引用不变。 */
function mergeMatches(episode: Episode, assignments: MatchAssignment[], replace: boolean): Episode {
  const selected = new Set(assignments.map((item) => item.imageId));
  let changed = false;
  const images = episode.images.map((image) => {
    const assignment = assignments.find((entry) => entry.imageId === image.id);
    if (!assignment || (image.matchConfidence === assignment.confidence && image.matchSource === assignment.source)) return image;
    changed = true;
    return { ...image, matchConfidence: assignment.confidence, matchSource: assignment.source };
  });
  const segments = episode.segments.map((segment) => {
    const base = replace ? segment.imageIds.filter((id) => !selected.has(id)) : [...segment.imageIds];
    const incoming = assignments.filter((entry) => entry.segmentIds.includes(segment.id)).map((entry) => entry.imageId);
    const merged = [...base];
    for (const id of incoming) {
      if (merged.includes(id)) continue;
      if (merged.length >= 6) continue;
      merged.push(id);
    }
    if (merged.join('|') === segment.imageIds.join('|')) return segment;
    changed = true;
    return { ...segment, imageIds: merged, confirmed: false };
  });
  return changed ? { ...episode, images, segments } : episode;
}

/**
 * 生成结果回填：只给真正写入字段的镜头打来源标记，只给产出草稿的段落标记「导演决策已生成」。
 * 无写入时不产生新对象，重复执行同一批生成不会改动快照（幂等）。
 */
function mergeDrafts(project: Project, episode: Episode, entry: { segmentId: string; drafts: ShotDraft[] }[], options: GenerationOptions, counter: GenerationResult): Episode {
  const bySegment = new Map(entry.map((item) => [item.segmentId, item.drafts]));
  let changed = false;
  const segments = episode.segments.map((segment) => {
    const drafts = bySegment.get(segment.id);
    if (!drafts) return segment;
    let filled = 0;
    const shots = segment.shots.map((shot) => {
      const draft = drafts.find((item) => item.shotId === shot.id);
      if (!draft) return shot;
      const next: Shot = { ...shot };
      const sourceFields = sourceFieldsForShot(project, episode, shot);
      let shotFilled = 0;
      // 旧快照可能已经存入无依据内容；证据型字段（⑩⑪⑬）可被生成通道校正回原稿证据，即使未开启覆盖。
      if (!next.locked && next.draftSource !== 'manual') {
        for (const key of ['action', 'performance', 'sound'] as const) {
          if (next[key].trim() && next[key].trim() !== sourceFields[key]) {
            next[key] = sourceFields[key];
            shotFilled += 1;
          }
        }
        // ④ 构图允许保留人工 / AI 的写法，只在主体位置与 ⑨ 站位互相矛盾时才收敛为同源描述。
        if (next.composition.trim() && compositionContradictsStaging(next.composition, sourceFields.blocking)) {
          next.composition = sourceFields.composition;
          shotFilled += 1;
        }
      }
      if (draft.purpose?.trim() && (options.overwrite || !next.purpose.trim())) {
        next.purpose = draft.purpose.trim();
        shotFilled += 1;
      }
      if (draft.duration !== undefined && next.duration !== 15) { next.duration = 15; shotFilled += 1; }
      for (const [key, rawValue] of Object.entries(draft.fields) as [EditableShotKey, string][]) {
        // 证据型字段必须有原稿证据；AI 返回的自由发挥在回填边界统一收敛为原稿字段。
        const value = key === 'action' || key === 'performance' || key === 'sound' ? sourceFields[key] : rawValue;
        if (!value || !value.trim()) continue;
        const current = String(next[key] ?? '');
        if (current.trim() && !options.overwrite) continue;
        (next as unknown as Record<string, string>)[key] = value.trim();
        shotFilled += 1;
      }
      if (shotFilled === 0) return shot;
      next.draftSource = options.source;
      filled += shotFilled;
      return next;
    });
    const shotChanged = shots.some((shot, index) => shot !== segment.shots[index]);
    counter.filled += filled;
    counter.segments += 1;
    const marked = true;
    if (!shotChanged && segment.directorGenerated === marked) return segment;
    changed = true;
    return { ...segment, confirmed: shotChanged ? false : segment.confirmed, directorGenerated: marked, shots };
  });
  return changed ? { ...episode, segments } : episode;
}

/** 启动恢复只允许真正执行一次：依赖误触发或 StrictMode 双调用都不会再引起自激循环。 */
let hydration: Promise<void> | null = null;
let hydrationEpoch = 0;

export const useWorkbench = create<State>((set, get) => ({
  project: null, selectedSegment: null, selectedShot: null,
  autosaveError: false, storageReady: false, migrated: false, storage: 'none',
  async hydrate() {
    if (get().storageReady) return;
    if (!hydration) {
      const epoch = hydrationEpoch;
      hydration = (async () => {
      try {
        const result = await loadDraft();
        if (epoch === hydrationEpoch && !get().project && result.project) set({ project: result.project, ...focus(result.project) });
        set({ storageReady: true, migrated: result.migrated, storage: result.storage });
      } catch { set({ storageReady: true }); }
      })();
    }
    await hydration;
  },
  async clearWorkspace() {
    hydrationEpoch += 1;
    hydration = Promise.resolve();
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    pendingProject = null;
    await clearDraft();
    set({ project: null, selectedSegment: null, selectedShot: null, migrated: false, autosaveError: false, storageReady: true, storage: 'none' });
  },
  setProject(project, focusFirst = true) {
    const next = migrateProject(project).project;
    persist(next);
    set({ project: next, ...(focusFirst ? focus(next) : {}) });
  },
  importScript(text, filename) {
    const project = createProject(text, filename.replace(/\.[^.]+$/, ''));
    project.scripts[0].filename = filename;
    get().setProject(project);
  },
  updateScript(text) {
    const old = get().project; if (!old) return;
    const version = `script-${old.scripts.length + 1}`;
    const project = { ...old, scripts: [...old.scripts, { id: version, text, filename: '编辑版本' }], activeScriptId: version };
    persist(project); set({ project });
  },
  replan() {
    const old = get().project; if (!old) return;
    const text = old.scripts.find((item) => item.id === old.activeScriptId)!.text;
    const planned = planProject(text, old.defaultMode);
    const keep = activeEpisode(old).index;
    const target = planned.episodes.find((episode) => episode.index === keep) ?? planned.episodes[0];
    const project: Project = { ...old, ...planned, activeEpisodeId: target.id };
    persist(project); set({ project, ...focus(project) });
  },
  setMode(mode) { const old = get().project; if (!old) return; const project = { ...old, defaultMode: mode }; persist(project); set({ project }); },
  selectEpisode(id) {
    const old = get().project; if (!old || old.activeEpisodeId === id) return;
    const project: Project = { ...old, activeEpisodeId: id };
    persist(project); set({ project, ...focus(project) });
  },
  focusTarget(episodeId, segmentId, shotId) {
    const old = get().project; if (!old) return;
    const episode = old.episodes.find((item) => item.id === episodeId); if (!episode) return;
    const project: Project = old.activeEpisodeId === episodeId ? old : { ...old, activeEpisodeId: episodeId };
    const segment = segmentId ? episode.segments.find((item) => item.id === segmentId) : undefined;
    const selectedSegment = segment?.id ?? episode.segments[0]?.id ?? null;
    const selectedShot = segment && shotId && segment.shots.some((item) => item.id === shotId) ? shotId : segment?.shots[0]?.id ?? null;
    if (project !== old) persist(project);
    set({ project, selectedSegment, selectedShot });
  },
  verifySplit() {
    const old = get().project; if (!old) return;
    const project = withEpisode(old, old.activeEpisodeId, (episode) => ({ ...episode, splitVerified: true }));
    persist(project); set({ project });
  },
  setSegmentMode(id, mode) {
    const old = get().project; if (!old) return;
    const project = { ...old, episodes: old.episodes.map((episode) => ({ ...episode, segments: episode.segments.map((segment) => segment.id === id ? { ...segment, mode, confirmed: false } : segment) })) };
    persist(project); set({ project });
  },
  selectSegment(id) { const episode = get().project ? activeEpisode(get().project!) : null; const segment = episode?.segments.find((item) => item.id === id); set({ selectedSegment: id, selectedShot: segment?.shots[0]?.id ?? null }); },
  selectShot(id) { set({ selectedShot: id }); },
  updateVisual(key, value) {
    const old = get().project; if (!old) return;
    const project = { ...old, visual: { ...old.visual, [key]: value, version: old.visual.version + 1, confirmed: false } };
    persist(project); set({ project });
  },
  confirmVisual() {
    const old = get().project; if (!old || !old.visual.character.trim() || !old.visual.scene.trim()) return;
    const project = { ...old, visual: { ...old.visual, confirmed: true } }; persist(project); set({ project });
  },
  addImage(image) {
    const old = get().project; if (!old) return;
    const episode = activeEpisode(old);
    if (episode.images.some((item) => item.sha256 === image.sha256)) return;
    const project = withEpisode(old, episode.id, (item) => ({ ...item, images: [...item.images, image] }));
    persist(project); set({ project });
  },
  addImages(images) {
    const old = get().project; if (!old) return { added: 0, duplicates: 0 };
    const episode = activeEpisode(old);
    const known = new Set(episode.images.map((item) => item.sha256));
    const accepted: ReferenceImage[] = [];
    let duplicates = 0;
    for (const image of images) {
      if (known.has(image.sha256)) { duplicates += 1; continue; }
      known.add(image.sha256); accepted.push(image);
    }
    if (accepted.length) {
      const project = withEpisode(old, episode.id, (item) => ({ ...item, images: [...item.images, ...accepted] }));
      persist(project); set({ project });
    }
    return { added: accepted.length, duplicates };
  },
  updateImage(id, description) {
    const old = get().project; if (!old) return;
    const project = { ...old, episodes: old.episodes.map((episode) => ({
      ...episode,
      images: episode.images.map((image) => image.id === id ? { ...image, description, confirmed: false, version: image.version + 1 } : image),
      segments: episode.segments.map((segment) => segment.imageIds.includes(id) ? { ...segment, confirmed: false } : segment),
    })) };
    persist(project); set({ project });
  },
  confirmImage(id) {
    const old = get().project; if (!old) return;
    const project = { ...old, episodes: old.episodes.map((episode) => ({ ...episode, images: episode.images.map((image) => image.id === id && image.description.trim() ? { ...image, confirmed: true } : image) })) };
    persist(project); set({ project });
  },
  toggleImage(segmentId, imageId) {
    const old = get().project; if (!old) return false;
    let overflow = false;
    const project = mutateSegmentImages(old, segmentId, (segment) => {
      const imageIds = segment.imageIds.includes(imageId) ? segment.imageIds.filter((id) => id !== imageId) : [...segment.imageIds, imageId];
      if (imageIds.length > 6) { overflow = true; return null; }
      return { ...segment, imageIds, confirmed: false };
    });
    if (overflow) return false;
    persist(project); set({ project });
    return true;
  },
  applyMatch(assignments, options, episodeId) {
    const old = get().project; if (!old) return;
    const episode = episodeId ? old.episodes.find((item) => item.id === episodeId) : activeEpisode(old);
    if (!episode) return;
    get().applyGenerationBatch([{ episodeId: episode.id, assignments }], { overwrite: false, source: 'local', replaceMatches: options?.replace });
  },
  applyGenerationBatch(entries, options) {
    const old = get().project; if (!old) return { filled: 0, segments: 0 };
    const byEpisode = new Map(entries.map((entry) => [entry.episodeId, entry]));
    const counter: GenerationResult = { filled: 0, segments: 0 };
    let changed = false;
    const episodes = old.episodes.map((episode) => {
      const entry = byEpisode.get(episode.id);
      if (!entry) return episode;
      let next = entry.assignments?.length ? mergeMatches(episode, entry.assignments, options.replaceMatches === true) : episode;
      if (entry.drafts?.length) next = mergeDrafts(old, next, entry.drafts, options, counter);
      if (next === episode) return episode;
      changed = true;
      return next;
    });
    if (changed) { const project: Project = { ...old, episodes }; persist(project); set({ project }); }
    return counter;
  },
  applyGenerated(segmentId, drafts, options) {
    const old = get().project; if (!old) return 0;
    const episode = old.episodes.find((item) => item.segments.some((segment) => segment.id === segmentId));
    if (!episode) return 0;
    return get().applyGenerationBatch([{ episodeId: episode.id, drafts: [{ segmentId, drafts }] }], options).filled;
  },
  updateShot(id, key, value) {
    const old = get().project; if (!old) return;
    const project = { ...old, episodes: old.episodes.map((episode) => ({
      ...episode,
      segments: episode.segments.map((segment) => ({ ...segment, confirmed: segment.shots.some((shot) => shot.id === id) ? false : segment.confirmed,
        shots: segment.shots.map((shot) => shot.id === id && !shot.locked ? { ...shot, [key]: value, ...(key === 'purpose' || key === 'duration' ? {} : { draftSource: 'manual' as DraftSource }) } : shot) })),
    })) };
    persist(project); set({ project });
  },
  confirmSegment(id) {
    const old = get().project; if (!old) return;
    const project = mutateSegmentImages(old, id, (segment) => ({ ...segment, confirmed: true }));
    persist(project); set({ project });
  },
}));
