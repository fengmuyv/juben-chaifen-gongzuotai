import { create } from 'zustand';
import { activeEpisode, type DefaultMode, type DraftSource, type Episode, type MatchConfidence, type MatchSource, type Project, type ReferenceImage, type Shot } from './core/model';
import { migrateProject } from './core/migrate';
import { createProject, planProject } from './core/planner';
import { loadDraft, saveDraft } from './core/storage';
import type { EditableShotKey } from './platforms/minimax-h3/skeleton';
import type { ShotDraft } from './platforms/minimax-h3/director';

export type MatchAssignment = { imageId: string; segmentIds: string[]; confidence: MatchConfidence; source: MatchSource; reason: string };
export type { ShotDraft };

type State = {
  project: Project | null; selectedSegment: string | null; selectedShot: string | null;
  autosaveError: boolean; storageReady: boolean; migrated: boolean; storage: 'indexeddb' | 'localstorage' | 'none';
  hydrate(): Promise<void>;
  setProject(project: Project, focus?: boolean): void;
  importScript(text: string, filename: string): void;
  updateScript(text: string): void; replan(): void; setMode(mode: DefaultMode): void;
  selectEpisode(id: string): void; verifySplit(): void;
  setSegmentMode(id: string, mode: 'dialogue' | 'action'): void; selectSegment(id: string): void; selectShot(id: string): void;
  updateVisual(key: 'character' | 'scene', value: string): void; confirmVisual(): void;
  addImage(image: ReferenceImage): void; addImages(images: ReferenceImage[]): { added: number; duplicates: number };
  updateImage(id: string, description: string): void; confirmImage(id: string): void;
  toggleImage(segmentId: string, imageId: string): boolean;
  applyMatch(assignments: MatchAssignment[], options?: { replace?: boolean }): void;
  applyGenerated(segmentId: string, drafts: ShotDraft[], options: { overwrite: boolean; source: DraftSource }): number;
  updateShot(id: string, key: EditableShotKey | 'duration' | 'purpose', value: string | number): void;
  confirmSegment(id: string): void;
};

function persist(project: Project) {
  saveDraft(project)
    .then(() => useWorkbench.setState({ autosaveError: false }))
    .catch(() => useWorkbench.setState({ autosaveError: true }));
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

export const useWorkbench = create<State>((set, get) => ({
  project: null, selectedSegment: null, selectedShot: null,
  autosaveError: false, storageReady: false, migrated: false, storage: 'none',
  async hydrate() {
    try {
      const result = await loadDraft();
      if (!get().project && result.project) set({ project: result.project, ...focus(result.project) });
      set({ storageReady: true, migrated: result.migrated, storage: result.storage });
    } catch { set({ storageReady: true }); }
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
  applyMatch(assignments, options) {
    const old = get().project; if (!old) return;
    const episode = activeEpisode(old);
    const selected = new Set(assignments.map((item) => item.imageId));
    const project = withEpisode(old, episode.id, (item) => {
      const images = item.images.map((image) => {
        const assignment = assignments.find((entry) => entry.imageId === image.id);
        if (!assignment) return image;
        return { ...image, matchConfidence: assignment.confidence, matchSource: assignment.source };
      });
      const segments = item.segments.map((segment) => {
        const base = options?.replace ? segment.imageIds.filter((id) => !selected.has(id)) : [...segment.imageIds];
        const incoming = assignments.filter((entry) => entry.segmentIds.includes(segment.id)).map((entry) => entry.imageId);
        const merged = [...base];
        for (const id of incoming) {
          if (merged.includes(id)) continue;
          if (merged.length >= 6) continue;
          merged.push(id);
        }
        return merged.join('|') === segment.imageIds.join('|') ? segment : { ...segment, imageIds: merged, confirmed: false };
      });
      return { ...item, images, segments };
    });
    persist(project); set({ project });
  },
  applyGenerated(segmentId, drafts, options) {
    const old = get().project; if (!old) return 0;
    let filled = 0;
    const project = mutateSegmentImages(old, segmentId, (segment) => ({ ...segment, confirmed: false, shots: segment.shots.map((shot) => {
      const draft = drafts.find((item) => item.shotId === shot.id);
      if (!draft) return shot;
      const next: Shot = { ...shot };
      for (const [key, value] of Object.entries(draft.fields) as [EditableShotKey, string][]) {
        if (!value || !value.trim()) continue;
        const current = String(next[key] ?? '');
        if (current.trim() && !options.overwrite) continue;
        (next as unknown as Record<string, string>)[key] = value.trim();
        filled += 1;
      }
      if (filled > 0) next.draftSource = options.source;
      return next;
    }) }));
    if (!filled) return 0;
    persist(project); set({ project });
    return filled;
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
