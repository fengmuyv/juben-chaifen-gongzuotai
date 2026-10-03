import { effectiveLength, episodeHeadingOf, parseChineseNumber } from './parser';

export { parseChineseNumber };

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

type Marker = { line: number; number: number | null; title: string };

/** `第1集` / `第01集` / `第一集` / `第1话` / `EP01` / `Episode 01`，允许集号后接标题。判定口径见 parser.episodeHeadingOf。 */
export function episodeLabel(index: number): string {
  return `第${String(index).padStart(2, '0')}集`;
}

function detectMarker(line: string): Marker | null {
  const heading = episodeHeadingOf(line);
  if (!heading) return null;
  return { line: 0, number: heading.number ?? null, title: heading.title };
}

/**
 * 整本剧本自动分集。识别不到集标时返回整本单集并标记未核对，绝不静默硬切。
 *
 * 切点只用**真集标**（`第 2 集「她啐了我一口」`）：集头导语（`第 2 集：扫荡戏开拍。…`）
 * 是整句简介，若当切点会把 60 集切成 167 段、集号反复倒退。同一集号命中多行时取最后一个
 * 真集标（导语与下集预告在前，真集标在后）。全部命中都是导语时退化为按导语切，并登记原因。
 */
export function splitEpisodes(text: string): EpisodeSplitResult {
  const lines = text.split('\n');
  const lineStarts: number[] = [];
  let cursor = 0;
  for (const line of lines) { lineStarts.push(cursor); cursor += line.length + 1; }
  const lineEnd = (index: number) => lineStarts[index] + lines[index].length;
  const detected: { marker: Marker; kind: 'heading' | 'preface' }[] = [];
  lines.forEach((line, i) => {
    const heading = episodeHeadingOf(line);
    if (!heading) return;
    detected.push({ marker: { ...detectMarker(line)!, line: i }, kind: heading.kind });
  });
  if (!detected.length) {
    return {
      recognized: false,
      reason: '未识别到集标（第N集 / 第N话 / EP0N / Episode 0N），已按整本单集处理，请人工核对切点。',
      episodes: [{ index: 1, label: episodeLabel(1), title: '', text, start: 0, end: text.length, startLine: 1, endLine: lines.length, charCount: effectiveLength(text) }],
    };
  }
  const onlyHeadings = detected.filter((item) => item.kind === 'heading');
  const usedPreface = onlyHeadings.length === 0;
  const source = (usedPreface ? detected : onlyHeadings).map((item) => item.marker);
  // 同一集号只保留最后一个切点（真集标在导语之后；下集预告会被后一集的导语覆盖）。
  const byNumber = new Map<number, Marker>();
  const unnumbered: Marker[] = [];
  source.forEach((marker) => {
    if (marker.number && marker.number > 0) byNumber.set(marker.number, marker);
    else unnumbered.push(marker);
  });
  const markers = [...byNumber.values(), ...unnumbered].sort((a, b) => a.line - b.line);
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
  const reason = usedPreface
    ? `未找到带标题的真集标，已按 ${episodes.length} 处集头导语切分，请核对切点行号。`
    : `已识别 ${episodes.length} 集，请核对集清单与切点行号。`;
  return { recognized: true, reason, episodes };
}
