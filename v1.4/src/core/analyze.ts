import type { ImageAnalysis, MatchConfidence } from './model';

export type KindGuess = ImageAnalysis['kindGuess'];

const kindKeywords: Record<KindGuess, string[]> = {
  character: ['人物', '角色', '人设', '定妆', '半身', '全身', '正面', '侧面', '背面', '特写', '脸', '演员', '明星', 'char', 'actor', 'person', 'portrait'],
  scene: ['场景', '环境', '内景', '外景', '室内', '室外', '街', '房', '厅', '室', '走廊', '山', '海', '树林', '城', '教室', '医院', '办公室', 'scene', 'env', 'bg', 'background', 'set'],
  prop: ['道具', '物件', '物品', '刀', '剑', '枪', '杯', '信', '钥匙', '箱', '钟', '灯', '书', '药', 'prop', 'item', 'object'],
};

/** 去噪词：方位、景别、序数等，不参与主体判定。 */
const noiseWords = ['正面', '侧面', '背面', '半身', '全身', '特写', '近景', '中景', '远景', '大全景', '人物', '角色', '场景', '道具', '参考', '定稿', 'png', 'jpg', 'jpeg', 'webp', 'img', 'image', 'v1', 'v2', 'final'];

function tokens(input: string): string[] {
  return input
    .replace(/\.[a-z0-9]{2,5}$/iu, '')
    .split(/[_\-\s·／/|,.，、（）()［］\[\]]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function significantTokens(input: string): string[] {
  return tokens(input).filter((token) => {
    const lower = token.toLowerCase();
    if (noiseWords.includes(lower)) return false;
    if (/^\d+$/u.test(token)) return false;
    return [...token].some((char) => /[\p{L}]/u.test(char));
  });
}

/** 图类判定：路径关键词 > 文件名关键词 > 画幅比例。 */
export function classifyKind(input: { name: string; path?: string; width?: number; height?: number }): { kind: KindGuess; reason: string } {
  const path = `${input.path ?? ''}`.toLowerCase();
  const name = input.name.toLowerCase();
  const order: KindGuess[] = ['character', 'scene', 'prop'];
  for (const source of [path, name] as const) {
    if (!source) continue;
    for (const kind of order) {
      const hit = kindKeywords[kind].find((word) => source.includes(word));
      if (hit) return { kind, reason: `${source === path ? '路径' : '文件名'}关键词「${hit}」` };
    }
  }
  const width = input.width ?? 0; const height = input.height ?? 0;
  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (ratio >= 1.5) return { kind: 'scene', reason: `画幅 ${width}×${height} 偏宽幅，判为场景` };
    if (ratio <= 0.8) return { kind: 'character', reason: `画幅 ${width}×${height} 偏竖幅，判为人物` };
    return { kind: 'prop', reason: `画幅 ${width}×${height} 接近方形，判为道具` };
  }
  return { kind: 'prop', reason: '无关键词与画幅信息，保守判为道具（不自动匹配）' };
}

export type Roster = { characters: string[]; scenes: string[] };

/** 主体提取：文件名主干去噪后与名册比对，命中唯一 → high，命中多个 → medium，未命中 → low。 */
export function extractSubject(name: string, roster: Roster): { subject: string | null; confidence: MatchConfidence; reason: string } {
  const candidates = significantTokens(name);
  if (!candidates.length) return { subject: null, confidence: 'low', reason: '文件名无有效主体词' };
  const known = [...roster.characters, ...roster.scenes];
  const hits = candidates.filter((token) => known.some((entry) => entry === token || entry.includes(token) || token.includes(entry)));
  if (hits.length >= 2) return { subject: hits[0], confidence: 'medium', reason: `文件名命中多个候选：${hits.join('、')}` };
  if (hits.length === 1) {
    const subject = known.find((entry) => entry === hits[0] || entry.includes(hits[0]) || hits[0].includes(entry)) ?? hits[0];
    return { subject, confidence: 'high', reason: `文件名主干「${hits[0]}」唯一命中名册` };
  }
  return { subject: null, confidence: 'low', reason: `文件名主干（${candidates.join('、')}）未命中说话人名册或场景名册` };
}

export type PixelStats = {
  dominant: string[];
  brightness: number;
  saturation: number;
  temperature: ImageAnalysis['temperature'];
  lightDirection: ImageAnalysis['lightDirection'];
  indoor: ImageAnalysis['indoor'];
};

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 缩略图像素统计：主色（量化取前 8）、平均亮度、饱和度、色温倾向、光源方位。
 * 纯函数，输入 RGBA 缓冲，可重复、可单测。
 */
export function analyzePixels(pixels: ArrayLike<number>, width: number, height: number): PixelStats {
  const total = Math.floor(pixels.length / 4);
  if (!total || width <= 0 || height <= 0) {
    return { dominant: [], brightness: 0.5, saturation: 0.3, temperature: 'neutral', lightDirection: 'flat', indoor: 'unknown' };
  }
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  let sumL = 0; let sumS = 0; let sumR = 0; let sumB = 0; let sumL2 = 0;
  const region = { top: { sum: 0, count: 0 }, bottom: { sum: 0, count: 0 }, left: { sum: 0, count: 0 }, right: { sum: 0, count: 0 } };
  const rowThird = height / 3; const colThird = width / 3;
  for (let index = 0; index < total; index++) {
    const alpha = pixels[index * 4 + 3] ?? 255;
    if (alpha < 16) continue;
    const r = pixels[index * 4]; const g = pixels[index * 4 + 1]; const b = pixels[index * 4 + 2];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const s = max === 0 ? 0 : (max - min) / max;
    sumL += l; sumL2 += l * l; sumS += s; sumR += r; sumB += b;
    const key = `${Math.floor(r / 32)},${Math.floor(g / 32)},${Math.floor(b / 32)}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
    const x = index % width; const y = Math.floor(index / width);
    if (y < rowThird) { region.top.sum += l; region.top.count += 1; }
    else if (y >= height - rowThird) { region.bottom.sum += l; region.bottom.count += 1; }
    if (x < colThird) { region.left.sum += l; region.left.count += 1; }
    else if (x >= width - colThird) { region.right.sum += l; region.right.count += 1; }
  }
  const brightness = sumL / total;
  const saturation = sumS / total;
  const variance = Math.max(0, sumL2 / total - brightness * brightness);
  const mean = (item: { sum: number; count: number }) => (item.count ? item.sum / item.count : 0);
  const top = mean(region.top); const bottom = mean(region.bottom); const left = mean(region.left); const right = mean(region.right);
  const spread = Math.max(Math.abs(top - bottom), Math.abs(left - right));
  let lightDirection: ImageAnalysis['lightDirection'] = 'flat';
  if (spread > 0.08) {
    if (Math.abs(top - bottom) >= Math.abs(left - right)) lightDirection = top >= bottom ? 'top' : 'bottom';
    else lightDirection = left >= right ? 'left' : 'right';
  }
  const neutral = sumR / total - sumB / total;
  const temperature: ImageAnalysis['temperature'] = neutral > 18 ? 'warm' : neutral < -18 ? 'cool' : 'neutral';
  const indoor: ImageAnalysis['indoor'] = variance > 0.02 && brightness > 0.5 ? 'outdoor' : variance < 0.006 ? 'indoor' : 'unknown';
  const visibleTotal = [...buckets.values()].reduce((sum, bucket) => sum + bucket.count, 0);
  const dominant = [...buckets.values()].filter((bucket) => bucket.count / visibleTotal >= 0.015)
    .sort((a, b) => b.count - a.count).slice(0, 8)
    .map((bucket) => hex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count));
  return { dominant, brightness: Math.round(brightness * 1000) / 1000, saturation: Math.round(saturation * 1000) / 1000, temperature, lightDirection, indoor };
}

export type AnalyzeInput = { name: string; path?: string; width?: number; height?: number; pixels?: ArrayLike<number> | null };

/** 本地引擎 A 入口：零 API、零联网。 */
export function analyzeImage(input: AnalyzeInput, roster: Roster): ImageAnalysis {
  const { kind, reason } = classifyKind(input);
  const subjectInfo = extractSubject(input.name, roster);
  const stats = input.pixels ? analyzePixels(input.pixels, input.width ?? 0, input.height ?? 0)
    : { dominant: [], brightness: 0.5, saturation: 0.3, temperature: 'neutral' as const, lightDirection: 'flat' as const, indoor: 'unknown' as const };
  return {
    kindGuess: kind, kindReason: reason,
    subject: subjectInfo.subject, subjectConfidence: subjectInfo.confidence,
    dominant: stats.dominant, brightness: stats.brightness, saturation: stats.saturation,
    temperature: stats.temperature, lightDirection: stats.lightDirection, indoor: stats.indoor,
  };
}

/** 生成最小本地描述：只保留原文件名与像素主色卡。 */
export function buildLocalDescription(input: { name: string; analysis: ImageAnalysis }): string {
  const colors = input.analysis.dominant.length ? input.analysis.dominant.join('、') : '未取到';
  const name = input.name.replace(/\.[^.]+$/u, '');
  return `${name}；主色：${colors}`;
}
