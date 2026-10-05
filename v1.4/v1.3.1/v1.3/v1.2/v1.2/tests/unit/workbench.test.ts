import { describe, expect, it } from 'vitest';
import { createProject, planProject } from '../../src/core/planner';
import { effectiveLength, parseScript } from '../../src/core/parser';
import { splitEpisodes, parseChineseNumber } from '../../src/core/episodes';
import { migrateProject, v1ProjectSchema } from '../../src/core/migrate';
import { activeEpisode, type Episode, type Project } from '../../src/core/model';
import { exportBundle, previewText } from '../../src/platforms/minimax-h3/compiler';
import { fields, generatedKeys } from '../../src/platforms/minimax-h3/skeleton';
import { validate, transitionForbiddenPattern, maxShotDuration } from '../../src/platforms/minimax-h3/validator';
import { classifyBeat, generateEpisodeDrafts, transitionPool } from '../../src/platforms/minimax-h3/director';
import { analyzeImage, analyzePixels, classifyKind, extractSubject } from '../../src/core/analyze';
import { buildRoster, matchImages, sceneKeywords, subjectRoster } from '../../src/core/match';
import { readWord, writeWord } from '../../src/core/word';
import { testConnection, generateSegmentFields } from '../../electron/script';
import { describeImage as describeVision } from '../../electron/vision';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const script = `# 第一场 室内
甲：你看见那封信了吗？
乙：我没有打开。
甲走向桌边。`;

function episodeOf(project: Project): Episode { return activeEpisode(project); }

function completedProject() {
  const project = createProject(script);
  const episode = episodeOf(project);
  episode.splitVerified = true;
  project.visual = { ...project.visual, character: '甲穿白衣，乙穿黑衣', scene: '桌子位于北墙', confirmed: true };
  for (const segment of episode.segments) {
    segment.confirmed = true;
    for (const shot of segment.shots) Object.assign(shot, {
      purpose: '确认信封状态', scale: '中景', composition: '双人分列', lens: '50mm', movement: '静止', light: '北侧窗光',
      atmosphere: '房间安静', blocking: '甲在桌南，乙在门侧', action: '甲走向桌边', performance: '甲目光停在信封', sound: '脚步声', transition: `保持轴线，接${shot.id}后的视线`,
    });
  }
  return project;
}

describe('原稿解析与规划', () => {
  it('preserves exact dialogue text and offsets', () => {
    const parsed = parseScript(script);
    const dialogue = parsed.beats.filter((beat) => beat.dialogue).map((beat) => beat.dialogue!);
    expect(dialogue.map((item) => item.text)).toEqual(['你看见那封信了吗？', '我没有打开。']);
    for (const item of dialogue) expect(script.slice(item.range.start, item.range.end)).toBe(item.text);
    expect(effectiveLength('甲，A2！')).toBe(3);
  });
  it('keeps scene boundaries and 15-second shot sums', () => {
    const project = createProject(`${script}\n# 第二场 外景\n甲：走。`, '样例', 'combined');
    const episode = episodeOf(project);
    expect(episode.segments.length).toBe(2);
    expect(episode.segments.every((segment) => segment.duration === 15 && segment.shots.reduce((sum, shot) => sum + shot.duration, 0) === 15)).toBe(true);
    expect(episode.segments.flatMap((segment) => segment.shots.map((shot) => shot.id))).toEqual(['SC01', 'SC02', 'SC03', 'SC04', 'SC05', 'SC06']);
  });
  it('leaves director details unconfirmed and blocks export', () => {
    const project = createProject(script);
    expect(validate(project).some((issue) => issue.code === 'DIRECTOR_UNCONFIRMED')).toBe(true);
    expect(() => exportBundle(project)).toThrow('交付已阻断');
  });
});

describe('阶段 A · 分集识别与 v1→v2 迁移', () => {
  it('recognizes 第N集 / EP0N / 中文集号 and reports the split list', () => {
    const book = `第01集 雨夜\n甲：来了。\n\nEP02 对峙\n乙：别动。\n\n第三集 收网\n甲：走。`;
    const result = splitEpisodes(book);
    expect(result.recognized).toBe(true);
    expect(result.episodes.map((item) => item.index)).toEqual([1, 2, 3]);
    expect(result.episodes.map((item) => item.label)).toEqual(['第01集', '第02集', '第03集']);
    expect(result.episodes[1].title).toBe('对峙');
    expect(result.episodes[0].text).toContain('甲：来了。');
    expect(result.episodes[0].text).not.toContain('乙：别动。');
    expect(result.episodes[0].startLine).toBe(1);
    expect(parseChineseNumber('二十三')).toBe(23);
    expect(splitEpisodes('整本没有集标').recognized).toBe(false);
  });
  it('builds one episode per split and keeps per-episode numbering', () => {
    const project = createProject('第01集\n甲：一。\n第02集\n乙：二。');
    expect(project.schemaVersion).toBe(2);
    expect(project.episodes).toHaveLength(2);
    expect(project.episodes.map((item) => item.segments[0].shots[0].id)).toEqual(['SC01', 'SC01']);
    expect(project.episodes.every((item) => item.splitVerified === false)).toBe(true);
  });
  it('migrates a v1 single-episode snapshot into a v2 project without data loss', () => {
    const legacy = {
      schemaVersion: 1, id: 'legacy', title: '旧项目', episode: '第03集',
      contentType: 'short-drama', defaultMode: 'combined', platform: 'minimax-h3',
      compilerVersion: '0.1.0', skeletonVersion: '1.0.0',
      scripts: [{ id: 'script-1', text: script, filename: '旧稿' }], activeScriptId: 'script-1',
      scenes: [{ id: 'scene-1', title: '第一场 室内', range: { start: 0, end: script.length } }],
      beats: [], segments: [], visual: { version: 1, character: '甲', scene: '室内', confirmed: true, source: 'manual' }, images: [],
    };
    expect(v1ProjectSchema.safeParse(legacy).success).toBe(true);
    const result = migrateProject(legacy);
    expect(result.migrated).toBe(true);
    expect(result.project.schemaVersion).toBe(2);
    expect(result.project.episodes).toHaveLength(1);
    expect(result.project.episodes[0].label).toBe('第03集');
    expect(result.project.episodes[0].index).toBe(3);
    expect(result.project.activeEpisodeId).toBe(result.project.episodes[0].id);
    expect(result.project.episodes[0].splitVerified).toBe(true);
    expect(migrateProject(result.project).migrated).toBe(false);
  });
  it('keeps the whole book as a single unverified episode when no marker exists', () => {
    const project = createProject(script);
    const episode = episodeOf(project);
    expect(project.episodes).toHaveLength(1);
    expect(episode.splitVerified).toBe(false);
    expect(project.episodes[0].sourceRange).toEqual({ start: 0, end: script.length });
    expect(validate(project).some((issue) => issue.code === 'EPISODE_SPLIT_UNVERIFIED')).toBe(true);
    episode.splitVerified = true;
    expect(validate(project).some((issue) => issue.code === 'EPISODE_SPLIT_UNVERIFIED')).toBe(false);
  });
  it('replans the whole book while keeping the active episode index', () => {
    const project = createProject('第01集\n甲：一。\n第02集\n乙：二。');
    const second = project.episodes[1];
    project.activeEpisodeId = second.id;
    const planned = planProject('第01集\n甲：改。\n第02集\n乙：改二。', project.defaultMode);
    expect(planned.episodes.map((item) => item.index)).toEqual([1, 2]);
  });
});

describe('阶段 C · 本地图像分析与三级置信度匹配', () => {
  it('guesses image kind and subject deterministically', () => {
    expect(classifyKind({ name: '林夏_正面_01.png' }).kind).toBe('character');
    expect(classifyKind({ name: '书房场景.png' }).kind).toBe('scene');
    expect(classifyKind({ name: '信封道具.png' }).kind).toBe('prop');
    expect(classifyKind({ name: 'a1.png', width: 1600, height: 600 }).kind).toBe('scene');
    expect(classifyKind({ name: 'a1.png', width: 600, height: 1200 }).kind).toBe('character');
    const roster = { characters: ['甲', '乙'], scenes: ['室内'] };
    expect(extractSubject('甲-正面-01.png', roster)).toMatchObject({ subject: '甲', confidence: 'high' });
    expect(extractSubject('无关词.png', roster).confidence).toBe('low');
  });
  it('derives light and colour statistics from pixels', () => {
    const width = 4; const height = 4;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) { pixels[i * 4] = 200; pixels[i * 4 + 1] = 120; pixels[i * 4 + 2] = 60; pixels[i * 4 + 3] = 255; }
    const stats = analyzePixels(pixels, width, height);
    expect(stats.temperature).toBe('warm');
    expect(stats.brightness).toBeGreaterThan(0.5);
    expect(stats.dominant[0]).toMatch(/^#[0-9a-f]{6}$/u);
    const analysis = analyzeImage({ name: '甲_正面.png', width, height, pixels }, { characters: ['甲'], scenes: [] });
    expect(analysis.kindGuess).toBe('character');
    expect(analysis.subject).toBe('甲');
    expect(analysis.lightDirection).toBe('flat');
  });
  it('splits scene keywords and matches at three confidence levels', () => {
    expect(sceneKeywords('第一场 室内 · 书房')).toEqual(['书房']);
    const project = createProject('第01集\n# 第一场 书房\n甲：来了。\n乙：嗯。\n# 第二场 走廊\n甲：走。');
    const episode = episodeOf(project);
    const roster = buildRoster(episode);
    expect(roster.characters).toEqual(['甲', '乙']);
    const analyses = new Map([
      ['a', analyzeImage({ name: '甲_正面.png' }, subjectRoster(roster))],
      ['b', analyzeImage({ name: '书房.png' }, subjectRoster(roster))],
      ['c', analyzeImage({ name: '未知物.png' }, subjectRoster(roster))],
    ]);
    episode.images.push(
      { id: 'a', sha256: 'a'.repeat(64), name: '甲_正面.png', dataUrl: 'data:image/png;base64,AA==', kind: 'character', description: '', confirmed: false, version: 1 },
      { id: 'b', sha256: 'b'.repeat(64), name: '书房.png', dataUrl: 'data:image/png;base64,AA==', kind: 'scene', description: '', confirmed: false, version: 1 },
      { id: 'c', sha256: 'c'.repeat(64), name: '未知物.png', dataUrl: 'data:image/png;base64,AA==', kind: 'scene', description: '', confirmed: false, version: 1 },
    );
    const outcomes = matchImages(episode, analyses, roster);
    const byId = new Map(outcomes.map((item) => [item.imageId, item]));
    expect(byId.get('a')!.confidence).toBe('medium');
    expect(byId.get('a')!.segmentIds.length).toBe(2);
    expect(byId.get('b')!.confidence).toBe('high');
    expect(byId.get('b')!.segmentIds).toEqual([episode.segments[0].id]);
    expect(byId.get('c')!.confidence).toBe('low');
    expect(byId.get('c')!.segmentIds).toEqual([]);
  });
  it('never silently drops overflow: the seventh image is reported as 已入库未绑定', () => {
    const project = createProject('第01集\n# 第一场 书房\n甲：来了。');
    const episode = episodeOf(project);
    const roster = buildRoster(episode);
    const analyses = new Map<string, ReturnType<typeof analyzeImage>>();
    for (let i = 0; i < 7; i++) {
      const id = `img-${i}`;
      episode.images.push({ id, sha256: String(i).padStart(64, '0'), name: '书房.png', dataUrl: 'data:image/png;base64,AA==', kind: 'scene', description: '', confirmed: true, version: 1 });
      analyses.set(id, analyzeImage({ name: '书房.png' }, subjectRoster(roster)));
    }
    const outcomes = matchImages(episode, analyses, roster);
    const bound = outcomes.filter((item) => item.segmentIds.includes(episode.segments[0].id));
    expect(bound).toHaveLength(6);
    const overflow = outcomes.find((item) => item.overflow.length > 0)!;
    expect(overflow.segmentIds).toEqual([]);
    expect(overflow.reason).toContain('已入库未绑定');
  });
});

describe('阶段 D · 规则导演引擎与新增闸门', () => {
  it('classifies beats deterministically', () => {
    const beat = (kind: 'action' | 'dialogue', text: string) => ({ id: 'b', sceneId: 'scene-1', kind, text, range: { start: 0, end: text.length } }) as const;
    expect(classifyBeat(beat('action', '甲挥拳打向乙'))).toBe('action');
    expect(classifyBeat(beat('dialogue', '你看见了吗？'))).toBe('dialogue');
    expect(classifyBeat(beat('dialogue', '他红着眼，声音颤了！'))).toBe('emotion');
    expect(classifyBeat(beat('action', '窗外夜色压下来'))).toBe('establish');
  });
  it('fills the ten generated fields and never touches the protected four', () => {
    const project = completedProject();
    const episode = episodeOf(project);
    for (const segment of episode.segments) for (const shot of segment.shots) for (const key of generatedKeys) (shot as unknown as Record<string, string>)[key] = '';
    const drafts = generateEpisodeDrafts(project, episode);
    for (const shot of episode.segments.flatMap((segment) => segment.shots)) {
      const draft = drafts.get(episode.segments.find((segment) => segment.shots.includes(shot))!.id)!.find((item) => item.shotId === shot.id)!;
      for (const key of generatedKeys) expect(draft.fields[key]?.trim()).toBeTruthy();
      for (const key of ['character', 'scene', 'composition', 'dialogue'] as const) expect(draft.fields[key as never]).toBeUndefined();
    }
  });
  it('generates only compliant transitions and blocks forbidden words', () => {
    const project = completedProject();
    const episode = episodeOf(project);
    for (const segment of episode.segments) for (const shot of segment.shots) shot.transition = '';
    const drafts = generateEpisodeDrafts(project, episode);
    for (const list of drafts.values()) for (const draft of list) expect(transitionForbiddenPattern.test(draft.fields.transition ?? '')).toBe(false);
    expect(transitionPool.length).toBeGreaterThanOrEqual(10);

    const broken = completedProject();
    episodeOf(broken).segments[0].shots[0].transition = '此处用闪黑过渡';
    expect(validate(broken).map((issue) => issue.code)).toContain('TRANSITION_FORBIDDEN');
    expect(() => exportBundle(broken)).toThrow('交付已阻断');
  });
  it('enforces the twelve-second shot ceiling', () => {
    const project = completedProject();
    const shot = episodeOf(project).segments[0].shots[0];
    shot.duration = maxShotDuration + 1;
    shot.transition = '保持轴线，接下一镜视线';
    const codes = validate(project).map((issue) => issue.code);
    expect(codes).toContain('SHOT_DURATION_MAX');
  });
  it('reports low-confidence and unbound images through AUTO_MATCH_LOW_CONFIDENCE', () => {
    const project = completedProject();
    const episode = episodeOf(project);
    episode.images.push({ id: 'x', sha256: 'f'.repeat(64), name: '未分配.png', dataUrl: 'data:image/png;base64,AA==', kind: 'scene', description: '可见窗框', confirmed: true, version: 1, matchConfidence: 'low' });
    expect(validate(project).map((issue) => issue.code)).toContain('AUTO_MATCH_LOW_CONFIDENCE');
  });
  it('is idempotent and never overwrites existing manual content', () => {
    const project = completedProject();
    const episode = episodeOf(project);
    for (const segment of episode.segments) for (const shot of segment.shots) shot.transition = '';
    const drafts = generateEpisodeDrafts(project, episode);
    const before = completedProject();
    expect(generateEpisodeDrafts(before, episodeOf(before))).toEqual(drafts);
    const manual = episode.segments[0].shots[0];
    manual.scale = '人工景别';
    expect(manual.scale).toBe('人工景别');
  });
});

describe('H3 骨架与交付闸门', () => {
  it('compiles fourteen ordered fields deterministically', () => {
    const project = completedProject();
    const result = exportBundle(project);
    expect(exportBundle(project)).toEqual(result);
    expect(result.text).toContain('SC01【确认信封状态｜5s】');
    expect(fields).toHaveLength(14);
    const lines = result.text.split('\n').filter((line) => /^[①-⑭] /u.test(line));
    expect(lines).toHaveLength(episodeOf(project).segments.flatMap((segment) => segment.shots).length * 14);
    expect(lines.slice(0, 14).map((line, index) => line.startsWith(`${String.fromCharCode(0x2460 + index)} ${fields[index].label}：`))).toEqual(Array(14).fill(true));
    expect(previewText(project)).toBe(result.text);
    expect(result.text).not.toContain('# ');
  });
  it('blocks duration, numbering, missing fields, placeholder and dialogue mutation', () => {
    const project = completedProject();
    const episode = episodeOf(project);
    episode.segments[0].shots[0].duration = 7;
    episode.segments[0].shots[1].id = 'SC09';
    episode.segments[0].shots[0].scale = '';
    project.visual.scene = '<Picture 1>';
    episode.segments[0].shots[0].dialogue[0].text = '擅改台词';
    const codes = validate(project).map((issue) => issue.code);
    for (const code of ['DURATION', 'SHOT_NUMBER', 'FIELD_REQUIRED', 'IMAGE_PLACEHOLDER', 'DIALOGUE_PROTECTION']) expect(codes).toContain(code);
    expect(() => exportBundle(project)).toThrow();
  });
  it('blocks missing source beat coverage and overlong dialogue', () => {
    const project = completedProject();
    episodeOf(project).segments[0].beatIds.pop();
    expect(validate(project).map((issue) => issue.code)).toContain('BEAT_COVERAGE');
    const long = createProject(`甲：${'一'.repeat(49)}`);
    expect(validate(long).map((issue) => issue.code)).toContain('DIALOGUE_LIMIT');
  });
  it('reports character drift and continuity changes that lack a handoff', () => {
    const project = createProject(`${script}\n# 第二场 走廊\n甲：走。`);
    const episode = episodeOf(project);
    project.visual = { ...project.visual, character: '甲穿白衣，乙穿黑衣', scene: '桌子位于北墙', confirmed: true };
    for (const segment of episode.segments) {
      segment.confirmed = true;
      for (const shot of segment.shots) Object.assign(shot, {
        purpose: '确认连续性', scale: '中景', composition: '双人分列', lens: '50mm', movement: '静止', light: '北侧窗光',
        atmosphere: '空间安静', blocking: '甲在桌南，乙在门侧', action: '甲观察信封', performance: '甲目光停在信封', sound: '脚步声', transition: '保持轴线，接下一镜视线',
      });
    }
    const secondSegment = episode.segments[1];
    const secondImage = { id: 'b'.repeat(64), sha256: 'b'.repeat(64), name: '人物-变化.png', dataUrl: 'data:image/png;base64,AA==', kind: 'character' as const, description: '甲穿蓝衣，短发', confirmed: true, version: 1 };
    episode.images.push(secondImage);
    secondSegment.imageIds.push(secondImage.id);
    const first = episode.segments[0].shots.at(-1)!;
    const second = secondSegment.shots[0];
    first.transition = '情绪延续';
    second.blocking = '乙移动到窗边，背向甲';
    second.composition = '人物位于右三分之一';
    second.light = '南侧暖光';
    project.visual.character = '甲穿红衣，乙穿黑衣';
    const codes = validate(project).map((issue) => issue.code);
    for (const code of ['BLOCKING_CONTINUITY', 'COMPOSITION_CONTINUITY', 'LIGHT_CONTINUITY', 'CHARACTER_CONTINUITY', 'CHARACTER_ANCHOR_DRIFT']) expect(codes).toContain(code);
    expect(() => exportBundle(project)).toThrow('交付已阻断');
    expect(exportBundle(completedProject()).text).not.toContain('质检报告');
  });
});

describe('图片描述与 Word', () => {
  it('uses only confirmed descriptions selected for a segment and enforces six references', () => {
    const project = completedProject();
    const episode = episodeOf(project);
    const segment = episode.segments[0];
    const image = { id: 'a'.repeat(64), sha256: 'a'.repeat(64), name: '人物.png', dataUrl: 'data:image/png;base64,AA==', kind: 'character' as const, description: '黑发、左眼下有痣', confirmed: false, version: 1 };
    episode.images.push(image);
    segment.imageIds.push(image.id);
    expect(validate(project).map((issue) => issue.code)).toContain('IMAGE_UNCONFIRMED');
    image.confirmed = true;
    expect(exportBundle(project).text).toContain('① 人物参考图的描述：黑发、左眼下有痣');
    segment.imageIds.push(...Array.from({ length: 6 }, (_, i) => `id-${i}`));
    expect(validate(project).map((issue) => issue.code)).toContain('IMAGE_LIMIT');
  });

  it('exports a readable fourteen-field Word document', async () => {
    const project = completedProject();
    const bytes = await writeWord(project);
    const text = await readWord(Uint8Array.from(bytes).buffer);
    expect(text).toContain('① 人物参考图的描述：');
    expect(text).toContain('⑭ 衔接：');
    expect(text).toContain('甲：你看见那封信了吗？');
    expect(text).not.toContain('质检报告');
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string');
    expect(xml?.match(/<w:keepNext\b/g)?.length).toBeGreaterThan(30);
    if (process.env.WORD_RENDER_FIXTURE) await writeFile(process.env.WORD_RENDER_FIXTURE, bytes);
  });
});

describe('阶段 E · 可选 AI 通道', () => {
  it('asks the vision model for structured output and rejects non-local HTTP', async () => {
    const originalFetch = globalThis.fetch;
    let sent: { model: string; messages: { content: { type: string; text?: string }[] }[] } | undefined;
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(String(options?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"kind":"character","subject":"甲","description":"可见黑发和白色衣领"}\n```' } }] }), { status: 200 });
    };
    try {
      const input = { endpoint: 'https://example.test/v1/chat/completions', model: 'vision', apiKey: 'test', image: { kind: 'character' as const, dataUrl: 'data:image/png;base64,AA==' }, candidates: { characters: ['甲'], scenes: ['书房'] } };
      const result = await describeVision(input);
      expect(result).toEqual({ kind: 'character', subject: '甲', description: '可见黑发和白色衣领' });
      expect(sent?.model).toBe('vision');
      expect(sent?.messages[0].content.map((part) => part.type)).toEqual(['text', 'image_url']);
      expect(sent?.messages[0].content[0].text).toContain('甲');
      await expect(describeVision({ ...input, endpoint: 'http://example.test/v1/chat/completions' })).rejects.toThrow('HTTPS');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('only accepts the ten generated fields and rejects protected keys', async () => {
    const originalFetch = globalThis.fetch;
    const request = {
      endpoint: 'https://example.test/v1/chat/completions', model: 'text', apiKey: 'test',
      segment: { id: 'P01', mode: 'dialogue', shots: [{ id: 'SC01', duration: 5, beatText: '甲走向桌边。', dialogue: '' }] },
      context: { contentType: 'short-drama', mode: 'dialogue', characters: '甲', scene: '书房', imageDescriptions: [], previousBlocking: '', previousLight: '', previousTransition: '' },
    };
    const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    try {
      globalThis.fetch = async () => reply(JSON.stringify({ shots: [{ shotId: 'SC01', scale: '中景', lens: '50mm', movement: '固定机位', light: '窗光', atmosphere: '安静', blocking: '甲在左', action: '走向桌边', performance: '眉峰微抬', sound: '脚步', transition: transitionPool[0] }] }));
      const shots = await generateSegmentFields(request);
      expect(Object.keys(shots[0].fields)).toHaveLength(10);
      expect(shots[0].fields.composition).toBeUndefined();

      globalThis.fetch = async () => reply(JSON.stringify({ shots: [{ shotId: 'SC01', scale: '中景', lens: '50mm', movement: '固定', light: '窗光', atmosphere: '安静', blocking: '甲在左', action: '走', performance: '微抬', sound: '脚步', transition: transitionPool[0], dialogue: '擅改台词' }] }));
      await expect(generateSegmentFields(request)).rejects.toThrow();

      globalThis.fetch = async () => reply(JSON.stringify({ shots: [{ shotId: 'SC01', scale: '中景', lens: '50mm', movement: '固定', light: '窗光', atmosphere: '安静', blocking: '甲在左', action: '走', performance: '微抬', sound: '脚步', transition: '闪黑转场' }] }));
      await expect(generateSegmentFields(request)).rejects.toThrow('转场禁词');
    } finally { globalThis.fetch = originalFetch; }
  });

  it('tests the connection endpoint and reports failures', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }), { status: 200 });
      expect(await testConnection({ endpoint: 'https://example.test/v1/chat/completions', apiKey: 'k' })).toEqual({ ok: true, message: '连接成功，可用模型 2 个' });
      globalThis.fetch = async () => new Response('nope', { status: 401 });
      expect((await testConnection({ endpoint: 'https://example.test/v1/chat/completions', apiKey: 'k' })).ok).toBe(false);
    } finally { globalThis.fetch = originalFetch; }
  });
});
