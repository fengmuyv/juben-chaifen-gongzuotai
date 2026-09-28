import type { Beat, Dialogue, Project } from './model';

export function effectiveLength(text: string): number {
  return [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
}

// Only natural punctuation boundaries may split a protected source dialogue.
function splitDialogue(speaker: string, text: string, offset: number): Dialogue[] {
  const clauses = [...text.matchAll(/[^，。！？；,!?;]+[，。！？；,!?;]*|[，。！？；,!?;]+/gu)];
  const result: Dialogue[] = [];
  let current = '';
  let start = offset;
  for (const clause of clauses) {
    if (current && effectiveLength(current + clause[0]) > 44) {
      result.push({ speaker, text: current, range: { start, end: start + current.length } });
      start = offset + clause.index;
      current = '';
    }
    current += clause[0];
  }
  if (current) result.push({ speaker, text: current, range: { start, end: start + current.length } });
  return result;
}

export function parseScript(text: string): Pick<Project, 'scenes' | 'beats'> {
  const scenes: Project['scenes'] = [];
  const beats: Beat[] = [];
  let cursor = 0;
  let currentScene: Project['scenes'][number] | undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const start = cursor + line.indexOf(trimmed);
    const end = start + trimmed.length;
    cursor += line.length + 1;
    if (!trimmed) continue;
    if (/^(?:#{1,6}\s+|第[^\s]{1,12}场|场次\s*\d|(?:内|外)[.． /-]|INT\.|EXT\.)/iu.test(trimmed)) {
      if (currentScene) currentScene.range.end = start;
      currentScene = { id: `scene-${scenes.length + 1}`, title: trimmed.replace(/^#+\s*/, ''), range: { start, end: text.length } };
      scenes.push(currentScene);
      continue;
    }
    if (!currentScene) {
      currentScene = { id: 'scene-1', title: '未标注场次', range: { start, end: text.length } };
      scenes.push(currentScene);
    }
    const match = /^([^：:\n]{1,20})[：:]\s*(.+)$/u.exec(trimmed);
    const addBeat = (dialogue?: Dialogue) => beats.push({
      id: `beat-${beats.length + 1}`, sceneId: currentScene!.id, kind: dialogue ? 'dialogue' : 'action',
      text: dialogue?.text ?? trimmed, range: dialogue?.range ?? { start, end }, dialogue,
    });
    if (match) {
      const dialogueStart = start + trimmed.length - match[2].length;
      splitDialogue(match[1].trim(), match[2], dialogueStart).forEach(addBeat);
    } else addBeat();
  }
  return { scenes, beats };
}
