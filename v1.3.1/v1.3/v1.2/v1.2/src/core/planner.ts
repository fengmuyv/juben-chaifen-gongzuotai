import type { Beat, DefaultMode, Episode, Mode, Project, Shot } from './model';
import { effectiveLength, parseScript } from './parser';
import { splitEpisodes, type EpisodeSplitResult } from './episodes';

function inferredMode(beat: Beat, mode: DefaultMode): Mode {
  if (mode !== 'combined') return mode;
  return beat.kind === 'action' && /挥|踢|砍|格挡|刺|扑|打斗|出拳|撞|摔|追击/u.test(beat.text) ? 'action' : 'dialogue';
}

/** 单集拆段：原 v1.0 规划逻辑，适配为集内上下文。 */
export function planEpisode(text: string, defaultMode: DefaultMode): Pick<Episode, 'scenes' | 'beats' | 'segments'> {
  const parsed = parseScript(text);
  const groups: { mode: Mode; beats: Beat[] }[] = [];
  for (const beat of parsed.beats) {
    const previous = groups.at(-1);
    const mode = inferredMode(beat, defaultMode);
    const dialogueCount = previous?.beats.reduce((sum, item) => sum + effectiveLength(item.dialogue?.text ?? ''), 0) ?? 0;
    if (!previous || previous.mode !== mode || previous.beats[0].sceneId !== beat.sceneId || previous.beats.length >= 5 || dialogueCount + effectiveLength(beat.dialogue?.text ?? '') > 44) {
      groups.push({ mode, beats: [beat] });
    } else previous.beats.push(beat);
  }
  let shotNumber = 0;
  const segments = groups.map((group, index) => {
    const count = Math.max(3, group.beats.length);
    const shots: Shot[] = Array.from({ length: count }, (_, i) => {
      const beat = group.beats[i];
      const number = ++shotNumber;
      return {
        id: `SC${String(number).padStart(2, '0')}`, duration: i === count - 1 ? 15 - Math.floor(15 / count) * (count - 1) : Math.floor(15 / count),
        beatIds: beat ? [beat.id] : [], dialogue: beat?.dialogue ? [beat.dialogue] : [], purpose: '', scale: '', composition: '', lens: '', movement: '',
        light: '', atmosphere: '', blocking: '', action: beat?.kind === 'action' ? beat.text : '', performance: '', sound: '', transition: '', locked: false,
      };
    });
    return { id: `P${String(index + 1).padStart(2, '0')}`, sceneId: group.beats[0].sceneId, mode: group.mode, duration: 15, beatIds: group.beats.map((beat) => beat.id), shots, confirmed: false, imageIds: [] };
  });
  return { ...parsed, segments };
}

/** 整本剧本 → 集数组（含分集识别结果）。 */
export function buildEpisodes(text: string, defaultMode: DefaultMode): { episodes: Episode[]; split: EpisodeSplitResult } {
  const split = splitEpisodes(text);
  const episodes: Episode[] = split.episodes.map((item, position) => ({
    id: `ep-${String(position + 1).padStart(2, '0')}`, label: item.label, index: item.index,
    sourceRange: { start: item.start, end: item.end },
    ...planEpisode(item.text, defaultMode), images: [], confirmed: false, splitVerified: false,
  }));
  return { episodes, split };
}

export function planProject(text: string, defaultMode: DefaultMode): Pick<Project, 'episodes' | 'activeEpisodeId'> {
  const { episodes } = buildEpisodes(text, defaultMode);
  return { episodes, activeEpisodeId: episodes[0].id };
}

export function createProject(text: string, title = '未命名作品', defaultMode: DefaultMode = 'combined'): Project {
  return {
    schemaVersion: 2, id: crypto.randomUUID(), title, contentType: 'short-drama', defaultMode,
    platform: 'minimax-h3', compilerVersion: '0.2.0', skeletonVersion: '1.0.0',
    scripts: [{ id: 'script-1', text, filename: '手动输入' }], activeScriptId: 'script-1',
    ...planProject(text, defaultMode),
    visual: { version: 1, character: '', scene: '', source: 'manual', confirmed: false },
  };
}
