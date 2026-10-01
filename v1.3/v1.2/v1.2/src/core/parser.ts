import type { Beat, Dialogue, Scene } from './model';

export type ScriptStructure = { scenes: Scene[]; beats: Beat[] };

export function effectiveLength(text: string): number {
  return [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
}

/** 分集标记行：第N集 / 第N话 / EP0N / Episode 0N，可后接标题。parser 与 episodes 共用同一口径。 */
const episodeCapture = /^\s*(?:第\s*([0-9]{1,4}|[零一二三四五六七八九十百千两]{1,8})\s*[集话章]|(?:EP|EPISODE)\s*([0-9]{1,4}))\s*(?:[：:、.．\-—]\s*)?(.*)$/iu;

/** 命中返回 [整行, 中文或阿拉伯集号, EP 集号, 标题]，未命中返回 null。 */
export function matchEpisodeMarker(line: string): RegExpExecArray | null {
  return episodeCapture.exec(line);
}

export function isEpisodeMarker(line: string): boolean {
  return matchEpisodeMarker(line) !== null;
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

export function parseScript(text: string): ScriptStructure {
  const scenes: Scene[] = [];
  const beats: Beat[] = [];
  let cursor = 0;
  let currentScene: Scene | undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const start = cursor + line.indexOf(trimmed);
    const end = start + trimmed.length;
    cursor += line.length + 1;
    if (!trimmed) continue;
    if (isEpisodeMarker(trimmed)) continue;
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
