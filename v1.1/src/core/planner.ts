import type { Beat, DefaultMode, Mode, Project, Shot } from './model';
import { effectiveLength, parseScript } from './parser';

function inferredMode(beat: Beat, mode: DefaultMode): Mode {
  if (mode !== 'combined') return mode;
  return beat.kind === 'action' && /挥|踢|砍|格挡|刺|扑|打斗|出拳|撞|摔|追击/u.test(beat.text) ? 'action' : 'dialogue';
}

export function plan(text: string, defaultMode: DefaultMode): Pick<Project, 'scenes' | 'beats' | 'segments'> {
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

export function createProject(text: string, title = '未命名作品', defaultMode: DefaultMode = 'combined'): Project {
  return {
    schemaVersion: 1, id: crypto.randomUUID(), title, episode: '第01集', contentType: 'short-drama', defaultMode,
    platform: 'minimax-h3', compilerVersion: '0.1.0', skeletonVersion: '1.0.0',
    scripts: [{ id: 'script-1', text, filename: '手动输入' }], activeScriptId: 'script-1', ...plan(text, defaultMode),
    visual: { version: 1, character: '', scene: '', source: 'manual', confirmed: false }, images: [],
  };
}
