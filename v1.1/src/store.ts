import { create } from 'zustand';
import { projectSchema, type DefaultMode, type Project, type ReferenceImage } from './core/model';
import { createProject, plan } from './core/planner';
import type { EditableShotKey } from './platforms/minimax-h3/skeleton';

const storageKey = 'script-storyboard-workbench-draft-v1';
function recover(): Project | null {
  try { return projectSchema.parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); } catch { return null; }
}
type State = {
  project: Project | null; selectedSegment: string | null; selectedShot: string | null; autosaveError: boolean;
  setProject(project: Project): void; importScript(text: string, filename: string): void;
  updateScript(text: string): void; replan(): void; setMode(mode: DefaultMode): void;
  setSegmentMode(id: string, mode: 'dialogue' | 'action'): void; selectSegment(id: string): void; selectShot(id: string): void;
  updateVisual(key: 'character' | 'scene', value: string): void; confirmVisual(): void;
  addImage(image: ReferenceImage): void; updateImage(id: string, description: string): void; confirmImage(id: string): void;
  toggleImage(segmentId: string, imageId: string): void;
  updateShot(id: string, key: EditableShotKey | 'duration' | 'purpose', value: string | number): void;
  confirmSegment(id: string): void;
};
function persist(project: Project) {
  try { localStorage.setItem(storageKey, JSON.stringify(project)); useWorkbench.setState({ autosaveError: false }); }
  catch { useWorkbench.setState({ autosaveError: true }); }
}

export const useWorkbench = create<State>((set, get) => ({
  project: recover(), selectedSegment: null, selectedShot: null, autosaveError: false,
  setProject(project) { persist(project); set({ project, selectedSegment: project.segments[0]?.id ?? null, selectedShot: project.segments[0]?.shots[0]?.id ?? null }); },
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
    get().setProject({ ...old, ...plan(text, old.defaultMode) });
  },
  setMode(mode) { const old = get().project; if (!old) return; const project = { ...old, defaultMode: mode }; persist(project); set({ project }); },
  setSegmentMode(id, mode) {
    const old = get().project; if (!old) return;
    const project = { ...old, segments: old.segments.map((segment) => segment.id === id ? { ...segment, mode, confirmed: false } : segment) };
    persist(project); set({ project });
  },
  selectSegment(id) { const segment = get().project?.segments.find((item) => item.id === id); set({ selectedSegment: id, selectedShot: segment?.shots[0]?.id ?? null }); },
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
    const old = get().project; if (!old || old.images.some((item) => item.sha256 === image.sha256)) return;
    const project = { ...old, images: [...old.images, image] }; persist(project); set({ project });
  },
  updateImage(id, description) {
    const old = get().project; if (!old) return;
    const project = { ...old, images: old.images.map((image) => image.id === id ? { ...image, description, confirmed: false, version: image.version + 1 } : image), segments: old.segments.map((segment) => segment.imageIds.includes(id) ? { ...segment, confirmed: false } : segment) };
    persist(project); set({ project });
  },
  confirmImage(id) {
    const old = get().project; if (!old) return;
    const project = { ...old, images: old.images.map((image) => image.id === id && image.description.trim() ? { ...image, confirmed: true } : image) };
    persist(project); set({ project });
  },
  toggleImage(segmentId, imageId) {
    const old = get().project; if (!old) return;
    const project = { ...old, segments: old.segments.map((segment) => {
      if (segment.id !== segmentId) return segment;
      const imageIds = segment.imageIds.includes(imageId) ? segment.imageIds.filter((id) => id !== imageId) : [...segment.imageIds, imageId];
      if (imageIds.length > 6) return segment;
      return { ...segment, imageIds, confirmed: false };
    }) };
    persist(project); set({ project });
  },
  updateShot(id, key, value) {
    const old = get().project; if (!old) return;
    const project = { ...old, segments: old.segments.map((segment) => ({ ...segment, confirmed: segment.shots.some((shot) => shot.id === id) ? false : segment.confirmed,
      shots: segment.shots.map((shot) => shot.id === id && !shot.locked ? { ...shot, [key]: value } : shot) })) };
    persist(project); set({ project });
  },
  confirmSegment(id) {
    const old = get().project; if (!old) return;
    const project = { ...old, segments: old.segments.map((segment) => segment.id === id ? { ...segment, confirmed: true } : segment) };
    persist(project); set({ project });
  },
}));
