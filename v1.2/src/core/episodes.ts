import { effectiveLength, matchEpisodeMarker } from './parser';

export type EpisodeSplit = {
  index: number;
  label: string;
  title: string;
  text: string;
  /** 该集文本在整本原稿中的字符范围。 */
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  charCount: number;
};

export type EpisodeSplitResult = {
  episodes: EpisodeSplit[];
  /** 识别到集标：true；兜底整本单集：false。 */
  recognized: boolean;
  /** 兜底原因说明，供 EPISODE_SPLIT_UNVERIFIED 闸门提示。 */
  reason: string;
};

const cnDigits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const cnUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 解析中文数字（支持 一 / 十 / 十二 / 二十三 / 一百零五 等常规写法）。 */
export function parseChineseNumber(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  let total = 0;
  let section = 0;
  let current = 0;
  for (const char of text) {
    if (char in cnDigits) { current = cnDigits[char]; continue; }
    if (char in cnUnits) {
      const unit = cnUnits[char];
      section += (current || 1) * unit;
      current = 0;
      continue;
    }
    return null;
  }
  total += section + current;
  return total > 0 ? total : null;
}

/** `第1集` / `第01集` / `第一集` / `第1话` / `EP01` / `Episode 01`，允许集号后接标题。判定口径见 parser.matchEpisodeMarker。 */
export function episodeLabel(index: number): string {
  return `第${String(index).padStart(2, '0')}集`;
}

type Marker = { line: number; number: number | null; title: string };

function detectMarker(line: string): Marker | null {
  const match = matchEpisodeMarker(line);
  if (!match) return null;
  const [, cn, en, title] = match;
  const number = cn ? (/^[0-9]+$/.test(cn) ? Number(cn) : parseChineseNumber(cn)) : en ? Number(en) : null;
  return { line: 0, number, title: (title ?? '').trim() };
}

/**
 * 整本剧本自动分集。识别不到集标时返回整本单集并标记未核对，绝不静默硬切。
 */
export function splitEpisodes(text: string): EpisodeSplitResult {
  const lines = text.split('\n');
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) { lineStarts.push(cursor); cursor += line.length + 1; }
  const lineEnd = (index: number) => lineStarts[index] + lines[index].length;
  const markers: Marker[] = [];
  lines.forEach((line, i) => {
    const marker = detectMarker(line);
    if (marker) markers.push({ ...marker, line: i });
  });
  if (!markers.length) {
    return {
      recognized: false,
      reason: '未识别到集标（第N集 / 第N话 / EP0N / Episode 0N），已按整本单集处理，请人工核对切点。',
      episodes: [{ index: 1, label: episodeLabel(1), title: '', text, start: 0, end: text.length, startLine: 1, endLine: lines.length, charCount: effectiveLength(text) }],
    };
  }
  const episodes: EpisodeSplit[] = [];
  markers.forEach((marker, position) => {
    const startLine = marker.line;
    const endLine = (position + 1 < markers.length ? markers[position + 1].line : lines.length) - 1;
    const index = marker.number && marker.number > 0 ? marker.number : position + 1;
    const body = lines.slice(startLine + 1, endLine + 1).join('\n').trim();
    episodes.push({
      index, label: episodeLabel(index), title: marker.title,
      text: lines.slice(startLine, endLine + 1).join('\n'),
      start: lineStarts[startLine], end: lineEnd(endLine),
      startLine: startLine + 1, endLine: endLine + 1, charCount: effectiveLength(body),
    });
  });
  return { recognized: true, reason: `已识别 ${episodes.length} 集，请核对集清单与切点行号。`, episodes };
}
