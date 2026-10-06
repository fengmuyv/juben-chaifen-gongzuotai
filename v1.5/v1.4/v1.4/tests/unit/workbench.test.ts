import { describe, expect, it } from 'vitest';
import { createProject, isMarkdownBrief, planProject } from '../../src/core/planner';
import { effectiveLength, headingKindOf, isBriefHeadingLine, isCastName, parseScript, speakerTrusted } from '../../src/core/parser';
import { splitEpisodes, parseChineseNumber } from '../../src/core/episodes';
import { migrateProject, projectSchemaTolerant, v1ProjectSchema } from '../../src/core/migrate';
import { activeEpisode, episodeOfShot, projectSchema, type Episode, type Project, type Shot } from '../../src/core/model';
import { exportBundle, previewText } from '../../src/platforms/minimax-h3/compiler';
import { fields, generatedKeys, values } from '../../src/platforms/minimax-h3/skeleton';
import { validate, transitionForbiddenPattern, shotDuration, issuePolicy } from '../../src/platforms/minimax-h3/validator';
import { auditEpisodeContent } from '../../src/platforms/minimax-h3/audit';
import { auditProject, canExportEpisode } from '../../src/platforms/minimax-h3/gate';
import { classifyBeat, compositionContradictsStaging, generateEpisodeDrafts, gradeForShot, projectCast, scaleSubjectConflict, sourceFieldsForShot, stagingFor, transitionPool } from '../../src/platforms/minimax-h3/director';
import { analyzeImage, analyzePixels, buildLocalDescription, classifyKind, extractSubject } from '../../src/core/analyze';
import { buildRoster, matchImages, sceneKeywords, subjectRoster } from '../../src/core/match';
import { readWord, writeWord } from '../../src/core/word';
import { testConnection, generateSegmentFields } from '../../electron/script';
import { decodeScriptBytes, isZipContainer, normalizeScriptText, sniffScriptPayload } from '../../electron/text';
import { describeImage as describeVision } from '../../electron/vision';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const script = `# 第一场 室内
甲：你看见那封信了吗？
乙：我没有打开。
甲走向桌边。`;

function episodeOf(project: Project): Episode { return activeEpisode(project); }

/** 单集补全：人工确认之外，同时标记生成通道已产出导演决策。 */
function completeEpisode(episode: Episode) {
  episode.splitVerified = true;
  for (const segment of episode.segments) {
    segment.confirmed = true;
    segment.directorGenerated = true;
    for (const shot of segment.shots) Object.assign(shot, {
      purpose: '确认信封状态', scale: '中景', composition: '双人分列', lens: '50mm', movement: '静止', light: '北侧窗光',
      atmosphere: '房间安静', blocking: '甲在桌南，乙在门侧', action: '甲走向桌边', performance: '甲目光停在信封', sound: '脚步声', transition: `保持轴线，接${shot.id}后的视线`,
    });
  }
}

function completedProject() {
  const project = createProject(script);
  project.visual = { ...project.visual, character: '甲穿白衣，乙穿黑衣', scene: '桌子位于北墙', confirmed: true };
  completeEpisode(episodeOf(project));
  return project;
}

/** 阻断项编号：只有 error 级才拦导出。 */
function errorCodes(project: Project): string[] {
  return validate(project).filter((issue) => issue.severity === 'error').map((issue) => issue.code);
}

describe('原稿解析与规划', () => {
  it('decodes UTF-8 and Chinese GB18030 script files without replacement characters', () => {
    expect(normalizeScriptText(decodeScriptBytes(new TextEncoder().encode('\uFEFF甲：你好。\r\n')))).toBe('甲：你好。\n');
    expect(decodeScriptBytes(Uint8Array.from([0xbc, 0xd7, 0xa3, 0xba, 0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xa1]))).toBe('甲：你好！');
  });
  it('routes a Word document renamed to .txt by content magic instead of extension', async () => {
    const word = await writeWord(createProject('甲：伪装 txt 的 Word 剧本。', '伪装样例'));
    const bytes = new Uint8Array(word);
    expect(isZipContainer(bytes)).toBe(true);
    expect(sniffScriptPayload(bytes)).toBe('docx');
    expect(await readWord(bytes.buffer)).toContain('甲：伪装 txt 的 Word 剧本。');
    expect(sniffScriptPayload(new TextEncoder().encode('甲：你好。'))).toBe('text');
  });
  it('decodes UTF-16 without BOM instead of silently garbling it', () => {
    const text = 'EP01 第1集\n甲：你看见那封信了吗？\n甲走向桌边。\n';
    expect(decodeScriptBytes(Uint8Array.from(Buffer.from(text, 'utf16le')))).toBe(text);
  });
  it('rejects legacy Word binaries and RTF with an actionable message', () => {
    expect(() => decodeScriptBytes(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(64).fill(0x41)]))).toThrow(/旧版 \.doc/);
    expect(() => decodeScriptBytes(new TextEncoder().encode('{\\rtf1\\ansi 剧本内容}'))).toThrow(/RTF/);
  });
  it('stops a binary payload from being force-decoded into mojibake', () => {
    const binary = Uint8Array.from({ length: 4096 }, (_, index) => (index % 7 === 0 ? 0x00 : index % 3 === 0 ? 0x1b : 0x80 + (index % 60)));
    expect(() => decodeScriptBytes(binary)).toThrow(/不是文本剧本/);
  });
  it('does not turn a Markdown specification into storyboard beats', () => {
    const brief = '# 剧情模板\n**类型：** 长篇AI漫剧\n**风格：** 中式治愈系\n**标签：** 都市奇幻\n---\n## 剧情梗概';
    expect(isMarkdownBrief(brief)).toBe(true);
  });
  it('does not treat bold Markdown metadata as dialogue', () => {
    const parsed = parseScript('**类型：** 长篇AI漫剧（共12集）\n甲：真正的台词。');
    expect(parsed.beats.map((beat) => beat.dialogue?.text)).toEqual(['真正的台词。']);
  });
  it('preserves exact dialogue text and offsets', () => {
    const parsed = parseScript(script);
    const dialogue = parsed.beats.filter((beat) => beat.dialogue).map((beat) => beat.dialogue!);
    expect(dialogue.map((item) => item.text)).toEqual(['你看见那封信了吗？', '我没有打开。']);
    for (const item of dialogue) expect(script.slice(item.range.start, item.range.end)).toBe(item.text);
    expect(effectiveLength('甲，A2！')).toBe(3);
  });
  it('distinguishes dialogue, inner monologue, and narration without changing source text', () => {
    const parsed = parseScript(`# 第一场 室内\n甲：你来了。\n内心OS：他怎么会在这里？\n旁白：雨落在窗上。\n（内心：我不能回答。）`);
    expect(parsed.beats.map((beat) => beat.dialogue?.kind)).toEqual(['dialogue', 'inner', 'narration', 'inner']);
    expect(parsed.beats.map((beat) => beat.dialogue?.text)).toEqual(['你来了。', '他怎么会在这里？', '雨落在窗上。', '我不能回答。']);
  });
  it('does not leak closing punctuation from parenthesized inner monologue into storyboard dialogue', () => {
    const parsed = parseScript('（内心：我不能回答。）');
    expect(parsed.beats[0].dialogue).toMatchObject({ kind: 'inner', speaker: '内心OS', text: '我不能回答。' });
  });
  it('keeps scene boundaries and makes every shot exactly 15 seconds', () => {
    const project = createProject(`${script}\n# 第二场 外景\n甲：走。`, '样例', 'combined');
    const episode = episodeOf(project);
    expect(episode.segments.length).toBe(2);
    expect(episode.segments.every((segment) => segment.duration === 15 && segment.shots.every((shot) => shot.duration === shotDuration))).toBe(true);
    expect(episode.segments.flatMap((segment) => segment.shots.map((shot) => shot.id))).toEqual(['SC01', 'SC02', 'SC03', 'SC04', 'SC05', 'SC06']);
  });
  it('blocks an unfinished episode while a merely unconfirmed one stays exportable', () => {
    const unfinished = createProject(script);
    expect(validate(unfinished).some((issue) => issue.code === 'DIRECTOR_UNCONFIRMED')).toBe(true);
    expect(errorCodes(unfinished)).toContain('FIELD_REQUIRED');
    expect(() => exportBundle(unfinished)).toThrow('交付已阻断');

    const written = completedProject();
    for (const segment of episodeOf(written).segments) segment.confirmed = false;
    expect(validate(written).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(() => exportBundle(written)).not.toThrow();
  });
});

describe('闸门分级：事实类阻断、人工类复核', () => {
  it('grades every gate through one policy table and never blocks on review items', () => {
    const raw = createProject(script);
    const issues = [...validate(raw), ...validate(completedProject())];
    expect(validate(raw).length).toBeGreaterThan(0);
    for (const issue of issues) {
      const policy = issuePolicy[issue.code as keyof typeof issuePolicy];
      expect(policy).toBeTruthy();
      expect(issue.severity).toBe(policy.severity);
      expect(issue.category).toBe(policy.category);
    }
    const blocking = Object.entries(issuePolicy).filter(([, policy]) => policy.severity === 'error').map(([code]) => code);
    expect(blocking.sort()).toEqual([
      'AXIS_JUMP', 'BEAT_COVERAGE', 'CHARACTER_ANCHOR_DRIFT', 'DIALOGUE_LIMIT', 'DIALOGUE_PROTECTION', 'DURATION', 'EMPTY',
      'FIELD_REQUIRED', 'IMAGE_LIMIT', 'IMAGE_PLACEHOLDER', 'PURPOSE_REQUIRED', 'SCENE_REFERENCE',
      'SEGMENT_NUMBER', 'SHOT_DURATION', 'SHOT_NUMBER', 'SHOT_SOURCE', 'SOURCE_STRUCTURE',
      'SOURCE_VERSION', 'SPEAKER_UNTRUSTED', 'TRANSITION', 'TRANSITION_FORBIDDEN', 'TRANSITION_PREMISE',
    ].sort());
    expect(blocking.some((code) => issuePolicy[code as keyof typeof issuePolicy].category === 'review')).toBe(false);
  });

  it('downgrades director confirmation to a review item and keeps the generated state visible', () => {
    const project = completedProject();
    for (const segment of episodeOf(project).segments) segment.confirmed = false;
    const unconfirmed = validate(project).filter((issue) => issue.code === 'DIRECTOR_UNCONFIRMED');
    expect(unconfirmed.length).toBeGreaterThan(0);
    expect(unconfirmed.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(unconfirmed.every((issue) => issue.category === 'review')).toBe(true);
    expect(unconfirmed[0].message).toContain('已生成');
    expect(errorCodes(project)).toEqual([]);

    const notGenerated = completedProject();
    for (const segment of episodeOf(notGenerated).segments) { segment.confirmed = false; segment.directorGenerated = false; }
    expect(validate(notGenerated).some((issue) => issue.code === 'DIRECTOR_UNCONFIRMED' && issue.message.includes('尚未生成，也未人工确认'))).toBe(true);
  });

  it('keeps blocking incomplete input, unconfirmed reference images, source mismatch and safety hits', () => {
    const incomplete = completedProject();
    episodeOf(incomplete).segments[0].shots[0].scale = '';
    expect(errorCodes(incomplete)).toContain('FIELD_REQUIRED');
    expect(() => exportBundle(incomplete)).toThrow('交付已阻断');

    const reference = completedProject();
    const episode = episodeOf(reference);
    const image = { id: 'a'.repeat(64), sha256: 'a'.repeat(64), name: '人物.png', dataUrl: 'data:image/png;base64,AA==', kind: 'character' as const, description: '', confirmed: false, version: 1 };
    episode.images.push(image);
    episode.segments[0].imageIds.push(image.id);
    expect(validate(reference).map((issue) => issue.code)).toContain('IMAGE_UNCONFIRMED');
    expect(() => exportBundle(reference)).not.toThrow();

    const source = completedProject();
    episodeOf(source).segments[0].shots[0].dialogue[0].text = '擅改台词';
    expect(errorCodes(source)).toContain('DIALOGUE_PROTECTION');
    expect(() => exportBundle(source)).toThrow('交付已阻断');

    const safety = completedProject();
    episodeOf(safety).segments[0].shots[0].transition = '此处用叠化过渡';
    expect(errorCodes(safety)).toContain('TRANSITION_FORBIDDEN');
    expect(() => exportBundle(safety)).toThrow('交付已阻断');
  });
});

describe('导出闸门：按集判定与可导出集清单', () => {
  function twoEpisodeProject() {
    const project = createProject('第01集 起\n# 第一场 书房\n甲：一。\n第02集 承\n# 第一场 走廊\n乙：二。');
    project.visual = { ...project.visual, character: '甲穿白衣', scene: '书房靠北墙', confirmed: true };
    for (const episode of project.episodes) completeEpisode(episode);
    return project;
  }

  it('keeps clean episodes exportable while another episode is blocked', () => {
    const project = twoEpisodeProject();
    const [first, second] = project.episodes;
    expect(project.episodes).toHaveLength(2);
    second.segments[0].shots[0].scale = '';

    const audit = auditProject(project);
    expect(audit.episodes.map((item) => item.episodeId)).toEqual([first.id, second.id]);
    expect(audit.exportableEpisodes.map((item) => item.episodeId)).toEqual([first.id]);
    expect(audit.errors.every((issue) => issue.episodeId === second.id && issue.episodeLabel === second.label)).toBe(true);
    expect(audit.errors.some((issue) => issue.category === 'input' && !!issue.segmentId && !!issue.shotId)).toBe(true);
    expect(audit.warnings.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(canExportEpisode(project, first.id)).toBe(true);
    expect(canExportEpisode(project, second.id)).toBe(false);
    expect(() => exportBundle(project, first.id)).not.toThrow();
    expect(() => exportBundle(project, second.id)).toThrow('交付已阻断');
  });

  it('reports a fully generated episode as exportable without human confirmation', () => {
    const project = twoEpisodeProject();
    for (const episode of project.episodes) for (const segment of episode.segments) segment.confirmed = false;
    const audit = auditProject(project);
    expect(audit.errors).toEqual([]);
    expect(audit.exportableEpisodes).toHaveLength(2);
    expect(audit.warnings.some((issue) => issue.code === 'DIRECTOR_UNCONFIRMED')).toBe(true);
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
  it('reads a v2 snapshot written by a newer compiler instead of losing the save', () => {
    const current = createProject(script);
    const fromFuture = { ...current, compilerVersion: '0.3.0', skeletonVersion: '2.0.0' };
    // 写入侧正本不受影响：未来版本号仍被严格 schema 拒绝。
    expect(projectSchema.safeParse(fromFuture).success).toBe(false);
    const result = migrateProject(fromFuture);
    // 读取兼容层必须兜住：落回 v1 分支会抛错，被 loadDraft 吞掉后表现为存档静默丢失。
    expect(result.project.schemaVersion).toBe(2);
    expect(result.project.compilerVersion).toBe('0.3.0');
    expect(result.project.episodes).toHaveLength(current.episodes.length);
    expect(result.project.episodes[0].segments[0].shots[0].id)
      .toBe(current.episodes[0].segments[0].shots[0].id);
    // 不是 v1→v2 迁移：不得触发「已从 v1.0 单集存档自动迁移」提示，也不需要回写。
    expect(result.migrated).toBe(false);
  });
  it('keeps fields added by a newer version so a downgraded round-trip cannot erase them', () => {
    const current = createProject(script);
    const fromFuture = { ...current, compilerVersion: '0.3.0', futureOnlyField: { keep: true } };
    // 兼容层必须非破坏性：zod 默认剥离未知键，那样降级读入即丢弃、随后一保存就永久抹掉。
    expect('futureOnlyField' in (migrateProject(fromFuture).project as object)).toBe(true);
    expect((migrateProject(fromFuture).project as unknown as { futureOnlyField: { keep: boolean } }).futureOnlyField.keep).toBe(true);
    // 当前版本写出的快照走严格正本，不额外引入未知键。
    expect('futureOnlyField' in (migrateProject(JSON.parse(JSON.stringify(current))).project as object)).toBe(false);
  });

  it('still rejects a structurally damaged v2 snapshot so the relaxation stays version-only', () => {
    const damaged = JSON.parse(JSON.stringify({ ...createProject(script), compilerVersion: '0.3.0' })) as Project;
    delete (damaged.episodes[0].segments[0].shots[0] as Partial<Shot>).scale;
    // 放宽只限版本指纹：缺正文条目的 v2 存档仍被兼容层拒绝，并保持原有抛错行为。
    expect(projectSchemaTolerant.safeParse(damaged).success).toBe(false);
    expect(() => migrateProject(damaged)).toThrow();
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
  it('reads reference descriptions from the owning episode even when shot numbers repeat across episodes', () => {
    const project = createProject('第01集 甲\n甲：一。\n第02集 乙\n乙：二。');
    const [first, second] = project.episodes;
    const reference = (id: string, sha: string, description: string) => ({
      id, name: id, sha256: sha.repeat(64), dataUrl: 'data:image/png;base64,AA==',
      kind: 'character' as const, description, confirmed: true, version: 1,
    });
    first.images.push(reference('img-a', 'a', '甲：白色衬衫，短发'));
    second.images.push(reference('img-b', 'b', '乙：黑色风衣，长发'));
    first.segments[0].imageIds = ['img-a'];
    second.segments[0].imageIds = ['img-b'];
    const firstShot = first.segments[0].shots[0];
    const secondShot = second.segments[0].shots[0];
    // 镜头编号跨集重复：按 id 定位会命中第一集，按引用定位才指向真正所属集。
    expect(secondShot.id).toBe(firstShot.id);
    expect(episodeOfShot(project, secondShot.id)?.id).toBe(first.id);
    expect(values(project, firstShot)[0]).toBe('甲：白色衬衫，短发');
    expect(values(project, secondShot)[0]).toBe('乙：黑色风衣，长发');
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
  it('keeps a representative palette of up to eight visible colours and ignores transparent pixels', () => {
    const colors = [
      [240, 20, 20], [20, 220, 20], [20, 20, 240], [220, 220, 20],
      [220, 20, 220], [20, 220, 220], [120, 60, 20], [240, 240, 240],
      [0, 0, 0], [80, 80, 80],
    ];
    const pixels = new Uint8ClampedArray((colors.length + 1) * 4);
    colors.forEach(([r, g, b], index) => { pixels.set([r, g, b, 255], index * 4); });
    pixels.set([255, 0, 255, 0], colors.length * 4);
    const stats = analyzePixels(pixels, colors.length + 1, 1);
    expect(stats.dominant).toHaveLength(8);
    expect(stats.dominant).not.toContain('#ff00ff');
    expect(stats.dominant.every((color) => /^#[0-9a-f]{6}$/u.test(color))).toBe(true);
  });
  it('builds an editable local description from deterministic image facts', () => {
    const analysis = analyzeImage({ name: '甲_正面.png', width: 600, height: 1200, pixels: new Uint8ClampedArray(600 * 1200 * 4) }, { characters: ['甲'], scenes: [] });
    const description = buildLocalDescription({ name: '甲_正面.png', analysis });
    expect(description).toBe('甲_正面；主色：未取到');
    expect(description).not.toContain('.png');
    expect(description).not.toContain('主体');
    expect(description).not.toContain('光线');
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
      expect(draft.purpose).toMatch(/^让观众/);
      for (const key of ['character', 'scene', 'dialogue'] as const) expect(draft.fields[key as never]).toBeUndefined();
      expect(draft.fields.composition).toBeTruthy();
    }
  });
  it('designs action and micro-expression from the drama when the shot has people but no source evidence', () => {
    const project = createProject('甲：你看见那封信了吗？');
    const episode = episodeOf(project);
    const draft = [...generateEpisodeDrafts(project, episode).values()][0][0];
    // 口径（2026-10-01 二次裁定）：本镜有人物时按剧情语义设计，不再一律填「无」。
    expect(draft.fields.action).not.toBe('无');
    expect(draft.fields.performance).not.toBe('无');
    expect(draft.fields.action).toContain('甲');
    expect(draft.fields.performance).toContain('甲');
    // 设计产物必须是肌群级 / 肢体级可执行动作，不得出现情绪形容词。
    expect(draft.fields.performance).not.toMatch(/紧张|愤怒|悲伤|开心|害怕|惊讶|无奈|尴尬/u);
    expect(draft.fields.performance).toMatch(/眉|眼|睑|唇|嘴|鼻|颌|喉|呼吸|泪|肩|手|指|重心/u);
  });
  it('keeps 无 for an empty shot with no person in frame', () => {
    const project = createProject('# 第一场\n夜色渐暗，房间保持安静。\n雨点砸在玻璃上。');
    const episode = episodeOf(project);
    const drafts = [...generateEpisodeDrafts(project, episode).values()].flat();
    for (const draft of drafts) {
      if ((draft.fields.blocking ?? '').includes('本镜无人物入画')) {
        expect(draft.fields.action).toBe('无');
        expect(draft.fields.performance).toBe('无');
      }
    }
  });
  it('keeps source evidence first and only designs what the source does not provide', () => {
    const project = createProject('第1集\n**人物设定：**\n陆时渊——集团继承人。\n苏清苒——设计师。\n# 第一场\n陆时渊皱眉。\n苏清苒走向桌边。');
    const episode = episodeOf(project);
    const drafts = [...generateEpisodeDrafts(project, episode).values()].flat();
    expect(drafts.some((draft) => draft.fields.performance === '陆时渊皱眉')).toBe(true);
    expect(drafts.some((draft) => (draft.fields.action ?? '').includes('苏清苒走向桌边（沿目标方向横向移动，间距逐步缩短）'))).toBe(true);
  });
  it('uses 无 for the dialogue field when a shot has no source dialogue or inner monologue', () => {
    const project = createProject('甲走向桌边。');
    const shot = episodeOf(project).segments[0].shots[0];
    expect(values(project, shot)[11]).toBe('无');
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

  // 口径（2026-10-01 修）：⑭ 衔接必须**按镜头证据选型**，不得按序号盲选。
  // 盲选会让空镜写「视线引导」、无台词镜写 L-Cut、无抬手动作的镜写「动作接动作」——
  // 真稿实测 1593 / 4512 镜（35.3%）张冠李戴。
  it('never gives an empty shot a transition that needs a person in frame', () => {
    const project = createProject('第1集\n# 第一场 客厅\n苏清苒：你终于来了。\n窗外雷声滚过，雨点砸在玻璃上。\n苏清苒推门而入。\n苏清苒坐下。', '空镜衔接');
    const episode = activeEpisode(project);
    const drafts = [...generateEpisodeDrafts(project, episode).values()].flat();
    const empty = drafts.find((draft) => (draft.fields.blocking ?? '').includes('无人物入画'));
    expect(empty).toBeTruthy();
    expect(empty!.fields.transition).not.toMatch(/视线引导|焦点转移接|遮挡转场|同向运动顺接|动作接动作/u);
  });

  it('only uses a dialogue-dependent transition when that dialogue exists', () => {
    const project = createProject('第1集\n# 第一场 客厅\n苏清苒：你终于来了。\n苏清苒推门而入。\n苏清苒坐下，皱眉。', '台词衔接');
    const episode = activeEpisode(project);
    const shots = episode.segments.flatMap((segment) => segment.shots);
    const drafts = [...generateEpisodeDrafts(project, episode).values()].flat();
    for (const draft of drafts) {
      const shot = shots.find((item) => item.id === draft.shotId)!;
      const next = shots[shots.indexOf(shot) + 1];
      const text = draft.fields.transition ?? '';
      const said = (list: { kind?: string }[]) => list.some((item) => (item.kind ?? 'dialogue') === 'dialogue');
      if (text.includes('L-Cut')) expect(said(shot.dialogue)).toBe(true);
      if (text.includes('J-Cut')) expect(said(next?.dialogue ?? [])).toBe(true);
    }
  });

  // 段末三种口径：本集收束 / 换场次重设轴线 / 同场次延续 —— 不得一律写「交棒下一段」。
  it('keeps the handoff wording honest at a scene change and at the end of an episode', () => {
    const text = `第1集
# 第一场 客厅
苏清苒：你终于来了。
苏清苒推门而入，走向沙发。
# 第二场 走廊
苏清苒：别跟过来。
苏清苒侧身避开。`;
    const project = createProject(text, '换场衔接');
    const episode = activeEpisode(project);
    const drafts = [...generateEpisodeDrafts(project, episode).values()].flat();
    expect(drafts.some((draft) => (draft.fields.transition ?? '').includes('换场衔接'))).toBe(true);
    // 「轴线与人物方位不变」只能出现在同场次承接里。
    for (const draft of drafts) {
      const text2 = draft.fields.transition ?? '';
      if (text2.includes('换场衔接')) expect(text2).not.toContain('轴线与人物方位不变');
    }
    const last = drafts[drafts.length - 1];
    expect(last.fields.transition).toBe('本集收束：以本镜落幅收住全集，保持本场轴线与光位不变，不留悬空动势');
  });

  it('enforces the twelve-second shot ceiling', () => {
    const project = completedProject();    const shot = episodeOf(project).segments[0].shots[0];
    shot.duration = shotDuration - 1;
    shot.transition = '保持轴线，接下一镜视线';
    const codes = validate(project).map((issue) => issue.code);
    expect(codes).toContain('SHOT_DURATION');
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
    expect(result.text).toContain('SC01【确认信封状态｜15s】');
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
    for (const code of ['SHOT_DURATION', 'SHOT_NUMBER', 'FIELD_REQUIRED', 'IMAGE_PLACEHOLDER', 'DIALOGUE_PROTECTION']) expect(codes).toContain(code);
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
    expect(validate(project).find((issue) => issue.code === 'IMAGE_UNCONFIRMED')?.severity).toBe('warning');
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
      segment: { id: 'P01', mode: 'dialogue', shots: [{ id: 'SC01', duration: 15, beatText: '甲走向桌边。', dialogue: '' }] },
      context: { contentType: 'short-drama', mode: 'dialogue', characters: '甲', scene: '书房', imageDescriptions: [], previousBlocking: '', previousLight: '', previousTransition: '' },
    };
    const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    try {
      globalThis.fetch = async () => reply(JSON.stringify({ shots: [{ shotId: 'SC01', scale: '中景', composition: '甲在左三分之一', lens: '50mm', movement: '固定机位', light: '窗光', atmosphere: '安静', blocking: '甲在左', action: '走向桌边', performance: '眉峰微抬', sound: '脚步', transition: transitionPool[0] }] }));
      const shots = await generateSegmentFields(request);
      expect(Object.keys(shots[0].fields)).toHaveLength(11);
      expect(shots[0].fields.composition).toBeTruthy();

      globalThis.fetch = async () => reply(JSON.stringify({ shots: [{ shotId: 'SC01', scale: '中景', lens: '50mm', movement: '固定', light: '窗光', atmosphere: '安静', blocking: '甲在左', action: '走', performance: '微抬', sound: '脚步', transition: transitionPool[0], dialogue: '擅改台词' }] }));
      await expect(generateSegmentFields(request)).rejects.toThrow();

      globalThis.fetch = async () => reply(JSON.stringify({ shots: [{ shotId: 'SC01', scale: '中景', composition: '甲在左', lens: '50mm', movement: '固定', light: '窗光', atmosphere: '安静', blocking: '甲在左', action: '走', performance: '微抬', sound: '脚步', transition: '闪黑转场' }] }));
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

describe('正文识别：故事梗概 / 来源 / 人物设定不进分镜', () => {
  const mixed = [
    '# 《旧梦难温》短剧剧本',
    '**来源：** 番茄小说《旧梦难温》第1-3章',
    '**类型：** 都市情感短剧',
    '**人物设定：**',
    '苏清苒——26岁，金牌律师，外冷内热。',
    '陆时渊——29岁，集团继承人，沉默寡言。',
    '**故事梗概：**',
    '三年前苏清苒不告而别，陆时渊在雨夜苦等一整夜。',
    '',
    '第1集 门开',
    '苏清苒推门而入，脚步在门口停住。',
    '苏清苒：你终于来了。',
    '陆时渊坐在沙发上，指尖敲了敲桌面。',
  ].join('\n');

  it('classifies metadata headings and single-line fields apart from script text', () => {
    expect(headingKindOf('**人物设定：**')).toBe('block');
    expect(headingKindOf('**故事梗概：**')).toBe('block');
    expect(headingKindOf('人物设定：')).toBe('block');
    expect(headingKindOf('# 人物设定')).toBe('block');
    expect(headingKindOf('**来源：** 番茄小说')).toBe('field');
    expect(headingKindOf('来源：番茄小说')).toBe('field');
    expect(headingKindOf('苏清苒：你终于来了。')).toBe('none');
    expect(headingKindOf('苏清苒推门而入，脚步在门口停住。')).toBe('none');
    expect(isBriefHeadingLine('# 人物设定')).toBe(true);
  });

  it('drops 来源 / 人物设定 / 故事梗概 blocks instead of turning them into shots', () => {
    const parsed = parseScript(mixed);
    expect(parsed.beats.map((beat) => beat.text)).toEqual([
      '苏清苒推门而入，脚步在门口停住。', '你终于来了。', '陆时渊坐在沙发上，指尖敲了敲桌面。',
    ]);
    expect(parsed.beats.some((beat) => /金牌律师|集团继承人|不告而别/.test(beat.text))).toBe(false);
    const project = createProject(mixed, '混合稿');
    const shots = activeEpisode(project).segments.flatMap((segment) => segment.shots);
    expect(shots[0].id).toBe('SC01');
    expect(values(project, shots[0])[11]).toBe('无');
  });

  it('leaves script text after a metadata block intact in plain text documents', () => {
    const plain = '故事梗概：\n三年前苏清苒不告而别。\n人物设定：\n苏清苒，26岁，金牌律师。\n第1集\n苏清苒推门而入。\n苏清苒：你终于来了。';
    expect(parseScript(plain).beats.map((beat) => beat.text)).toEqual(['苏清苒推门而入。', '你终于来了。']);
  });

  // 真实剧稿里大量叙述行含全角冒号（`余额：2,430。` / `门上贴着三个字：…`）：
  // 冒号前 ≤20 字不等于「说话人」，说话人不可信时整行是叙述，必须按 action 处理。
  it('treats a narration line with a colon as action, never as dialogue', () => {
    const text = '第1集\n# 第一场\n余额：2,430。\n门上贴着三个字：严禁入内。\n画面猛地拉开：一把军刀抵在小女孩脖子上。\n苏清苒：你终于来了。';
    const parsed = parseScript(text);
    expect(parsed.beats.map((beat) => beat.kind)).toEqual(['action', 'action', 'action', 'dialogue']);
    expect(parsed.beats[0].text).toBe('余额：2,430。');
    expect(parsed.beats[1].text).toBe('门上贴着三个字：严禁入内。');
    expect(parsed.cast).toEqual(['苏清苒']);
  });

  // 附录「补写说明」里单行 `动因：…` / `做法：…` 不得当作台词把非正文块提前解屏。
  it('keeps an appendix block closed until a scene heading or episode marker arrives', () => {
    const text = [
      '三、路 A 补写说明（画面密度）',
      '动因：全剧台词密度正常，但画面密度前后失衡。',
      '做法：在 EP31—EP60 逐集定点插入可拍叙述行。',
      '六道护栏（全部通过）：G1 锚点集内唯一命中。',
      '三条验收断言（全部通过）：A1 逐集完全相同。',
      '第2集 收束',
      '# 第一场 办公室',
      '林昊：把门带上。',
    ].join('\n');
    const parsed = parseScript(text);
    expect(parsed.beats.map((beat) => beat.text)).toEqual(['把门带上。']);
  });

  it('still recognizes a pure specification document at the import gate', () => {
    expect(isMarkdownBrief('# 剧情模板\n**类型：** 长篇AI漫剧\n**风格：** 中式治愈系\n**标签：** 都市奇幻')).toBe(true);
  });
});

describe('人物识别：字段落到原稿真实姓名', () => {
  it('reads the cast from 人物设定 blocks and trusted speakers', () => {
    const project = createProject('第1集\n**人物设定：**\n陆时渊——29岁，集团继承人。\n# 第一场\n苏清苒：你终于来了。\n苏清苒推门而入，脚步在门口停住。');
    expect(projectCast(project)).toEqual(['陆时渊', '苏清苒']);
  });

  it('never mistakes a body part or a numeral for a person', () => {
    const project = createProject('第1集\n**人物设定：**\n陆时渊——29岁，集团继承人。\n苏清苒——26岁，设计师。\n# 第一场\n陆时渊坐在沙发上，指尖敲了敲桌面。\n陆时渊站起身，一步一步走到她面前。\n苏清苒猛地转身，眼泪落下来。');
    const cast = projectCast(project);
    expect(cast).toContain('陆时渊');
    expect(cast).toContain('苏清苒');
    for (const bogus of ['指尖', '一步一步', '眼', '眼泪']) expect(cast).not.toContain(bogus);
  });

  // 口径（2026-10-01 修）：叙述句主语**不再发现人物**，只做佐证。
  // 真稿上「动词前 1~4 字」的近似名（冯京一 / 慢慢 / 同一 / 椅子 / 往门口）曾污染 ⑨ 站位；
  // 现只补登记两类：① 已确证姓名；② 命中单一来源角色称谓表（小女孩 / 老人 / 鬼子兵）。
  it('never lets a narration subject invent a person, only corroborate one', () => {
    const text = '第1集\n**人物设定：**\n冯京——旧军靴的主人。\n# 第一场 审讯室\n冯京：把带子倒回去。\n冯京一抬头，话卡在了喉咙里。\n慢慢走向门口。\n小女孩转身跑开，老人靠在墙边。';
    const project = createProject(text, '叙述佐证');
    const cast = projectCast(project);
    expect(cast).toContain('冯京');
    expect(cast).toContain('小女孩');
    expect(cast).toContain('老人');
    for (const bogus of ['冯京一', '慢慢']) expect(cast).not.toContain(bogus);
    // 名册干净后 ⑨ 站位不得再写出臆造主体。
    const drafts = [...generateEpisodeDrafts(project, activeEpisode(project)).values()].flat();
    expect(drafts.every((draft) => !(draft.fields.blocking ?? '').includes('冯京一'))).toBe(true);
    expect(drafts.every((draft) => !(draft.fields.blocking ?? '').includes('慢慢'))).toBe(true);
  });

  // 单源判据 `isCastName`：名册条目必须是「像人名的词」，方位短语 / 泛指 / 部位词 / 数量短语一律拒收。
  it('rejects locative phrases, generics, body parts and quantifiers as cast names', () => {
    for (const bogus of ['窗口后', '电话那头', '门口这边', '那个人', '众人', '指尖', '肩膀', '一步一步', '余额', '总账', '门']) {
      expect(isCastName(bogus)).toBe(false);
    }
    for (const real of ['苏清苒', '陆时渊', '林夏', '甲']) expect(isCastName(real)).toBe(true);
  });

  // 真稿里 `发送时间：十一点五十二分。` 是叙述行（说明短信何时发出），`下面有人喊："…"` 是舞台指示：
  // 两者都不是说话人，必须按 action 保留原文，且不得进名册。
  it('never mistakes a field label or a stage direction for a speaker', () => {
    for (const bogus of ['发送时间', '通话时长', '账号号码', '下面有人喊', '旁边某人', '门外那人']) {
      expect(isCastName(bogus)).toBe(false);
    }
    const text = '第1集\n# 第一场 化妆间\n发送时间：十一点五十二分。\n下面有人喊："解完这根就下来！"\n苗苗：单子核完了。';
    const parsed = parseScript(text);
    expect(parsed.beats.map((beat) => beat.kind)).toEqual(['action', 'action', 'dialogue']);
    expect(parsed.beats[0].text).toBe('发送时间：十一点五十二分。');
    expect(parsed.cast).toEqual(['苗苗']);
  });

  // 说话人可信度（单一来源）：不可信的「标签：值」行是叙述行，必须降级为 action，不得进 ⑫ 台词。
  it('trusts a real speaker but never a locative tag or a document word', () => {
    expect(speakerTrusted('苏清苒')).toBe(true);
    expect(speakerTrusted('苏清苒', ['苏清苒'])).toBe(true);
    expect(speakerTrusted('护士')).toBe(true);
    expect(speakerTrusted('投资方代表')).toBe(true);
    expect(speakerTrusted('黑衣人甲')).toBe(true);
    expect(speakerTrusted('余额')).toBe(false);
    expect(speakerTrusted('窗口后')).toBe(false);
    expect(speakerTrusted('电话那头')).toBe(false);
    expect(speakerTrusted('一个非常长的非人名标签')).toBe(false);
    expect(speakerTrusted('')).toBe(false);
  });

  it('names both people in a shared shot and keeps them on opposite thirds', () => {
    const text = `第1集 走廊
**人物设定：**
陈默——28岁，投资人。
# 第一场 走廊
苏清苒：别碰它。
陈默扑向她的右手，林夏侧身避开，两人的肩膀撞到走廊墙面。
林夏：你听见了吗？`;
    const project = createProject(text, '双人');
    const drafts = [...generateEpisodeDrafts(project, activeEpisode(project)).values()].flat();
    const pair = drafts.find((draft) => draft.fields.blocking?.includes('分列'))!;
    expect(pair.fields.blocking).toContain('分列画面左右三分之一');
    expect(pair.fields.composition).toContain('主体分列画面左右三分之一');
    expect(pair.fields.action).toContain('陈默和林夏肩膀撞到走廊墙面');
    expect(drafts.every((draft) => !/主要人物|人物位于/.test(draft.fields.blocking ?? ''))).toBe(true);
  });

  // 口径（2026-10-01 老大裁定）：侧位是「（场次锚 + 人名）→ 左/右」的纯函数，
  // 与本镜还有谁入画无关 —— 旧实现按本镜前两名分列，第三人一入画就翻转（真稿 110 处跳变）。
  it('keeps a person on one fixed side no matter who else is in the shot', () => {
    const anchor = ['林夏', '陈默', '记者甲'];
    expect(stagingFor(['陈默', '记者甲'], '', anchor).blocking).toContain('左侧记者甲与右侧陈默');
    expect(stagingFor(['记者甲'], '', anchor).blocking).toContain('记者甲位于画面左三分之一');
    // 同一侧的人员仍逐个写出姓名与朝向，位置不因他人在场而改变。
    expect(stagingFor(['林夏', '记者甲'], '', anchor).blocking).toContain('林夏与记者甲位于画面左三分之一');
  });

  // 口径（2026-10-01 老大裁定）：左右由**场次轴线锚**决定，不随节拍类别、也不随「谁说话」跳 —— 越轴即穿帮。
  it('derives the side from the scene anchor, never from the beat category or the speaker', () => {
    const anchor = ['林夏', '陈默'];
    expect(stagingFor(['林夏'], '', anchor).side).toBe('左');
    expect(stagingFor(['陈默'], '', anchor).side).toBe('右');
    // 输入顺序不再决定左右：锚序靠前者恒在左。
    expect(stagingFor(['陈默', '林夏'], '', anchor).blocking).toContain('左侧林夏与右侧陈默');
    // 无锚（单主体场次）时收首主体在左，仍不按节拍类别切换。
    expect(stagingFor(['苏清苒'], '', []).side).toBe('左');
  });

  it('keeps one person on the same side in every shot of a scene', () => {
    const text = `第1集
# 第一场 卧室
苏清苒坐在床边，眼泪落下来。
苏清苒：我不该回来的。
苏清苒推门而出。`;
    const project = createProject(text, '轴线');
    const drafts = [...generateEpisodeDrafts(project, activeEpisode(project)).values()].flat();
    const sides = drafts
      .map((draft) => draft.fields.blocking ?? '')
      .filter((blocking) => blocking.includes('苏清苒'))
      .map((blocking) => (blocking.includes('画面左三分之一') ? '左' : blocking.includes('画面右三分之一') ? '右' : blocking.includes('画面中央') ? '中' : '?'));
    expect(sides.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sides).size).toBe(1);
  });

  it('locks a two-person axis so the scene’s first speaker stays on the left', () => {
    const text = `第1集
# 第一场 客厅
林夏：你听见了吗？
陈默：我什么都没听见。`;
    const project = createProject(text, '正反打');
    const drafts = [...generateEpisodeDrafts(project, activeEpisode(project)).values()].flat();
    expect(drafts[0].fields.blocking).toContain('林夏位于画面左三分之一');
    expect(drafts[1].fields.blocking).toContain('陈默位于画面右三分之一');
    // 补位镜继承主体时不得换边。
    expect(drafts[2].fields.blocking).toContain('陈默位于画面右三分之一');
  });

  // 口径（2026-10-01 修）：**可信说话人一律进名册** —— 说话人子通道不再走「像不像人名」的启发式
  // 二次过滤。否则「投资方代表甲」（>5 字）与「灯光师」（含「灯光」命中环境词）会被误杀，
  // 表现为「台词镜写得出、继承镜写不出」。⑨ 只写裸名，⑫ 保留原文。
  it('keeps every trusted speaker in the roster and writes the bare name into ⑨', () => {
    const text = '第1集\n# 第一场 会议室\n投资方代表甲：这个方案我不同意。';
    const project = createProject(text, '泛称');
    expect(projectCast(project)).toContain('投资方代表甲');
    const episode = activeEpisode(project);
    const drafts = [...generateEpisodeDrafts(project, episode).values()].flat();
    expect(drafts[0].fields.blocking).toContain('投资方代表甲位于画面左三分之一');
    expect(values(project, episode.segments[0].shots[0])[11]).toBe('投资方代表甲：这个方案我不同意。');
  });

  // ⑨ 站位是画面描述，不写舞台注解；⑫ 台词保留原稿原文（零篡改）。
  it('strips the stage annotation from ⑨ while ⑫ keeps the source label', () => {
    const text = '第1集\n# 第一场 剪辑室\n林昊（画外音）：把带子倒回去。';
    const project = createProject(text, '画外音');
    const episode = activeEpisode(project);
    expect(parseScript(text).beats[0].dialogue?.speaker).toBe('林昊（画外音）');
    expect(values(project, episode.segments[0].shots[0])[11]).toBe('林昊（画外音）：把带子倒回去。');
    const drafts = [...generateEpisodeDrafts(project, episode).values()].flat();
    expect(drafts[0].fields.blocking).toContain('林昊位于画面左三分之一');
    expect(drafts[0].fields.blocking).not.toContain('画外音');
  });
});

describe('证据型生成：构图 / 肢体动作 / 音效', () => {
  const scene = `# 第一场 客厅
苏清苒推门而入，脚步在门口停住。
苏清苒：你终于来了。
陆时渊坐在沙发上，指尖敲了敲桌面。
窗外雷声滚过，雨点砸在玻璃上。
苏清苒猛地转身，眼泪落下来。`;

  function draftsOf(text: string) {
    const project = createProject(text);
    return [...generateEpisodeDrafts(project, activeEpisode(project)).values()].flat();
  }

  it('writes body actions as action plus direction instead of dumping the whole sentence', () => {
    const entry = draftsOf(scene).find((draft) => draft.fields.action?.includes('推门而入'))!;
    expect(entry.fields.action).toBe('苏清苒推门而入（由门外向内，沿画面纵深方向进入）；苏清苒脚步在门口停住（位移在当前位置终止，重心回收）');
  });

  it('keeps environment and sound description out of the body-action field', () => {
    const thunder = draftsOf(scene).find((draft) => draft.fields.sound?.startsWith('雷声；雨声'))!;
    expect(thunder.fields.action).toBe('无');
    expect(thunder.fields.blocking).toContain('无人物入画');
    expect(thunder.fields.composition).toContain('画面无人物主体');
    expect(compositionContradictsStaging(thunder.fields.composition!, thunder.fields.blocking!)).toBe(false);
  });

  it('never repeats one clause in both body action and micro-expression', () => {
    const turn = draftsOf(scene).find((draft) => draft.fields.action?.includes('转身'))!;
    expect(turn.fields.action).toBe('苏清苒猛地转身（身体绕纵轴改变朝向）');
    expect(turn.fields.performance).toBe('苏清苒眼泪落下来');
    expect(turn.fields.action).not.toContain('眼泪');
  });

  it('uses 无 for 音效 when neither source evidence nor a scene environment is available', () => {
    expect(draftsOf('# 第一场\n苏清苒：你终于来了。\n陆时渊皱眉。').every((draft) => draft.fields.sound === '无')).toBe(true);
  });

  it('derives 音效 only from source sound evidence', () => {
    const drafts = draftsOf('# 第一场\n苏清苒推开房门。\n苏清苒的脚步停住。\n远处钟声一响。');
    expect(drafts.map((draft) => draft.fields.sound)).toEqual(['门被推开的声响', '脚步落地的声响', '钟表走时声']);
  });

  // 口径（2026-10-01 三次裁定）：⑬ 无声音证据时，按剧情所处环境补一层空间底噪。
  it('adds a scene ambience layer to 音效 when the source carries no sound evidence', () => {
    const soundsOf = (text: string) => draftsOf(text).map((draft) => draft.fields.sound);
    expect(soundsOf('# 第一场 书房 · 白天\n苏清苒：你终于来了。').every((sound) => sound === '室内安静空气层与窗外远处车流的持续底噪')).toBe(true);
    expect(soundsOf('# 第一场 医院走廊 · 夜\n苏清苒：你终于来了。').every((sound) => sound === '走廊尽头间歇的推车滚轮声与远处电子提示音的持续底噪')).toBe(true);
  });

  it('keeps evidence and drops the redundant ambience when the same topic is already in the source', () => {
    const [rainShot, ...rainRest] = draftsOf('# 第一场 街边 · 雨夜\n雨点砸在玻璃上。').map((draft) => draft.fields.sound);
    expect(rainShot).toBe('雨声；远处车流与人流走动的持续环境声');
    expect(rainRest.every((sound) => sound === '远处车流与人流走动的持续环境声')).toBe(true);
    const [windShot, ...windRest] = draftsOf('# 第一场 天台 · 夜\n风穿过栏杆，远处霓虹闪烁。').map((draft) => draft.fields.sound);
    expect(windShot).toBe('风声；夜间环境底噪：远处稀疏车声与虫鸣');
    expect(windRest.every((sound) => sound === '高处风穿过栏杆的持续风声')).toBe(true);
  });

  // 真实剧稿用标准场次头（`场景 3　日.内　办公室`）：具体地点未命中时，由剧本自带的内外 / 昼夜标记兜底。
  it('derives the ambience layer from the scene heading 内外 / 昼夜 markers', () => {
    const soundsOf = (text: string) => draftsOf(text).map((draft) => draft.fields.sound);
    expect(soundsOf('场景 1　日.内　资料室\n苏清苒：你终于来了。').every((sound) => sound === '室内空调低鸣与键盘间歇敲击的持续底噪')).toBe(true);
    expect(soundsOf('场景 2　日.外　晒谷场\n苏清苒：你终于来了。').every((sound) => sound === '开阔场地的风声与远处零星人声鸡犬的持续底噪')).toBe(true);
    expect(soundsOf('场景 3　夜.内　某处\n苏清苒：你终于来了。').every((sound) => sound === '室内夜间环境底噪：灯具电流低鸣与窗外稀疏夜声')).toBe(true);
    expect(soundsOf('场景 4　日.外　某处\n苏清苒：你终于来了。').every((sound) => sound === '室外日间环境底噪：风穿过开阔空间与远处人声车声')).toBe(true);
  });

  // 口径（2026-10-01）：⑤光源 / ⑧氛围 与 ⑬底噪 共用同一套场次标记，不再全片同一句常量。
  it('derives 光源 and 氛围 from the scene 内外 / 昼夜 markers instead of one fixed line', () => {
    const lightsOf = (text: string) => draftsOf(text).map((draft) => draft.fields.light);
    const moodsOf = (text: string) => draftsOf(text).map((draft) => draft.fields.atmosphere);
    const nightIndoor = '场景 1　夜.内　卧室\n苏清苒：你终于来了。';
    const dayOutdoor = '场景 2　日.外　晒谷场\n苏清苒：你终于来了。';
    expect(lightsOf(nightIndoor).every((value) => value === '夜间室内：灯具顶光与侧光并用，暖冷混合色温，低照度，暗部靠环境补光')).toBe(true);
    expect(moodsOf(nightIndoor).every((value) => value === '低照度冷调，局部光源区亮，室内封闭，暗部占比大')).toBe(true);
    expect(lightsOf(dayOutdoor).every((value) => value === '日间外景：露天顶光为主，色温偏高，高照度，阴影边界清晰')).toBe(true);
    expect(moodsOf(dayOutdoor).every((value) => value === '中性偏暖调，色彩通透，室外开阔，光比清晰')).toBe(true);
    // 无任何场次标记时才回落到中性底盘，但同片内仍随场次变化。
    expect(lightsOf('# 第一场 客厅\n苏清苒：你终于来了。').every((value) => value === '自然散射光，中性色温，中等照度')).toBe(true);
  });

  it('keeps composition consistent with blocking and free of absent actions', () => {
    const drafts = draftsOf(scene);
    for (const draft of drafts) {
      expect(draft.fields.composition).toMatch(/^主体位置：/);
      expect(draft.fields.composition!.split('；')).toHaveLength(5);
      expect(compositionContradictsStaging(draft.fields.composition!, draft.fields.blocking!)).toBe(false);
    }
    const empty = drafts.find((draft) => draft.fields.blocking?.includes('无人物入画'))!;
    expect(empty.fields.composition).not.toContain('交锋');
    expect(empty.fields.composition).toContain('画面四边保留完整空间边界');
  });

  it('keeps the transition pool free of any scripted prop or location', () => {
    const text = transitionPool.join('');
    for (const noun of ['信封', '钟表', '窗棂', '门把手']) expect(text).not.toContain(noun);
  });

  it('keeps the shot title short enough for the 标题行', () => {
    const project = createProject('# 第一场\n苏清苒推门而入，脚步在门口停住，目光扫过整间屋子。');
    const draft = [...generateEpisodeDrafts(project, activeEpisode(project)).values()][0][0];
    expect(draft.purpose).toBe('让观众看清苏清苒推门而入的起势与结果');
    expect([...(draft.purpose ?? '')].length).toBeLessThanOrEqual(24);
  });
});

// ③ 景别 × 入画人数：档位只按节拍类型给基准是不够的 —— 人脸特写收不下两个主体，
// 人物档景别也套不住空镜。校正结果驱动 ③⑤⑥ 与 ④ 构图，两处取同一个 grade。
describe('景别档位随入画人数校正（③ 与 ④ 同源）', () => {
  it('sizes every template scale to the number of people in frame', () => {
    // 单主体：保持基准档。
    expect(gradeForShot('dialogue', 1).scale).toBe('过肩中景');
    expect(gradeForShot('action', 1).scale).toBe('中近景');
    expect(gradeForShot('emotion', 1).scale).toBe('面部特写');
    expect(gradeForShot('establish', 1).scale).toBe('大全景');
    // 双主体：单人档升为双人档，人脸特写不再写「特写」（否则与 ④ 的两人构图文案打架）。
    expect(gradeForShot('emotion', 2)).toEqual({ scale: '双人中近景', lens: '50mm', movement: '微幅前移' });
    expect(gradeForShot('action', 2).scale).toBe('双人中近景');
    expect(gradeForShot('emotion', 4).scale).toBe('双人中近景');
    // 空镜：人物档退为空间档，肩背与面部都无处可拍。
    expect(gradeForShot('emotion', 0).scale).toBe('大全景');
    expect(gradeForShot('dialogue', 0).scale).toBe('大全景');
    expect(gradeForShot('action', 0).scale).toBe('全景');
    // 全景别与非人物档不受人数影响。
    expect(gradeForShot('establish', 0).scale).toBe('大全景');
    expect(gradeForShot('establish', 3).scale).toBe('大全景');
  });

  it('never produces a scale/frame conflict for any category and headcount', () => {
    for (const category of ['action', 'dialogue', 'emotion', 'establish'] as const) {
      for (const count of [0, 1, 2, 3, 5]) {
        const grade = gradeForShot(category, count);
        expect(scaleSubjectConflict(grade.scale, count), `${category} × ${count} 人 → ${grade.scale}`).toBeNull();
      }
    }
  });

  it('flags the incompatible pairings through the shared predicate', () => {
    expect(scaleSubjectConflict('面部特写', 2)).toBeTruthy();
    expect(scaleSubjectConflict('面部特写', 0)).toBeTruthy();
    expect(scaleSubjectConflict('过肩中景', 0)).toBeTruthy();
    expect(scaleSubjectConflict('中近景', 0)).toBeTruthy();
    expect(scaleSubjectConflict('面部特写', 1)).toBeNull();
    expect(scaleSubjectConflict('过肩中景', 2)).toBeNull();
    expect(scaleSubjectConflict('大全景', 0)).toBeNull();
    // 人工自创的收窄档位仍按人脸特写判；人工自创的其它档位不在表内 → 放行（宁可漏报不误报）。
    expect(scaleSubjectConflict('大特写', 3)).toBeTruthy();
    expect(scaleSubjectConflict('中景', 0)).toBeNull();
  });

  it('drops people-scale framings on shots with nobody in frame', () => {
    const project = createProject('# 第一场 片场 · 日\n林夏：开始。\n信封从桌面滑落，砸在地上。\n# 第二场 棚外 · 日\n雨点砸在铁皮棚顶上，溅起一层白雾。', '空镜');
    const episode = activeEpisode(project);
    const drafts = generateEpisodeDrafts(project, episode);
    const shots = episode.segments.flatMap((segment) => segment.shots);
    const empty = [...drafts.values()].flat()
      .map((draft) => ({ draft, count: sourceFieldsForShot(project, episode, shots.find((shot) => shot.id === draft.shotId)!).subjects.length }))
      .filter((item) => item.count === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const { draft } of empty) expect(['大全景', '全景'], `空镜写了人物档：${draft.fields.scale}`).toContain(draft.fields.scale);
  });

  it('inherits the previous subjects when a mirror-match marker hides the pronoun', () => {
    const project = createProject('# 第一场 屋内 · 夜\n林夏：别开窗。\n【接·视线】他抬头，看向窗外。', '接戏');
    const episode = activeEpisode(project);
    const drafts = generateEpisodeDrafts(project, episode);
    const shot = episode.segments.flatMap((segment) => segment.shots)
      .find((item) => episode.beats.find((beat) => item.beatIds.includes(beat.id))?.text.startsWith('【接·视线】'))!;
    const draft = [...drafts.values()].flat().find((item) => item.shotId === shot.id)!;
    expect(draft.fields.blocking).toContain('林夏');
    expect(scaleSubjectConflict(draft.fields.scale ?? '', 1)).toBeNull();
  });
});

// 通用一致性审计：判据全部来自原稿与生成端同源函数，**不含任何作品专属词表**，
// 因此换任何一部剧本都不需要单独升级 —— 导入 → 生成 → 审计自动执行。
describe('通用一致性审计：换任何原稿都自动执行', () => {
  const text = `第1集
# 第一场 客厅
林夏：你听见了吗？
陈默：我什么都没听见。
林夏抬手拦住陈默。
陈默侧身避开。`;

  function freshEpisode() {
    const project = createProject(text, '审计');
    return { project, episode: activeEpisode(project) };
  }

  it('reports nothing on freshly generated content', () => {
    const { project, episode } = freshEpisode();
    const drafts = generateEpisodeDrafts(project, episode);
    for (const list of drafts.values()) {
      for (const draft of list) {
        const shot = episode.segments.flatMap((segment) => segment.shots).find((item) => item.id === draft.shotId)!;
        for (const [key, value] of Object.entries(draft.fields)) (shot as unknown as Record<string, string>)[key] = value ?? '';
      }
    }
    expect(auditEpisodeContent(project, episode)).toEqual([]);
  });

  it('catches an axis jump introduced by hand', () => {
    const { project, episode } = freshEpisode();
    const shots = episode.segments.flatMap((segment) => segment.shots);
    shots[0].blocking = '林夏位于画面右三分之一，身体朝向画面左侧';
    shots[1].blocking = '林夏位于画面左三分之一，身体朝向画面右侧';
    const codes = auditEpisodeContent(project, episode).map((issue) => issue.code);
    expect(codes).toContain('AXIS_JUMP');
  });

  it('catches a named subject that the script never contains', () => {
    const { project, episode } = freshEpisode();
    episode.segments[0].shots[0].blocking = '左侧冯京一与右侧慢慢分列画面左右三分之一';
    const codes = auditEpisodeContent(project, episode).map((issue) => issue.code);
    expect(codes).toContain('BLOCKING_UNKNOWN_SUBJECT');
  });

  it('catches a transition whose premise is missing', () => {
    const { project, episode } = freshEpisode();
    const shot = episode.segments[0].shots.find((item) => !item.dialogue.length) ?? episode.segments[0].shots[2];
    shot.dialogue = [];
    shot.transition = 'L-Cut：本镜台词延续到下一镜画面，用声音搭桥完成空间切换';
    expect(auditEpisodeContent(project, episode).map((issue) => issue.code)).toContain('TRANSITION_PREMISE');
  });

  it('catches a scale that cannot hold the people in frame', () => {
    const { project, episode } = freshEpisode();
    // 第 3 镜的原稿证据确实是两人同时入画（林夏抬手拦住陈默）。
    const shot = episode.segments[0].shots.find((item) => item.id === 'SC03')!;
    shot.scale = '面部特写';
    expect(auditEpisodeContent(project, episode).map((issue) => issue.code)).toContain('SCALE_SUBJECT_CONFLICT');
  });

  it('catches a people-scale framing left on an empty frame', () => {
    const project = createProject('# 第一场 棚外 · 日\n林夏：开始。\n雨点砸在铁皮棚顶上，溅起一层白雾。', '空镜审计');
    const episode = activeEpisode(project);
    const shot = episode.segments.flatMap((segment) => segment.shots)
      .find((item) => sourceFieldsForShot(project, episode, item).subjects.length === 0)!;
    // 生成端不会这么写；这里模拟人工把空镜改回人物档。
    shot.scale = '过肩中景';
    expect(auditEpisodeContent(project, episode).map((issue) => issue.code)).toContain('SCALE_SUBJECT_CONFLICT');
  });

  it('catches a composition that contradicts the blocking', () => {
    const { project, episode } = freshEpisode();
    const shot = episode.segments[0].shots[0];
    shot.blocking = '林夏位于画面左三分之一，身体朝向画面右侧';
    shot.composition = '主体位置：主体位于画面右三分之一；视线焦点落在主体面部；浅景深';
    expect(auditEpisodeContent(project, episode).map((issue) => issue.code)).toContain('STAGING_COMPOSITION_CONFLICT');
  });

  it('is wired into validate so every import is checked without a manual audit', () => {
    const { project, episode } = freshEpisode();
    episode.segments[0].shots[0].transition = 'L-Cut：本镜台词延续到下一镜画面，用声音搭桥完成空间切换';
    episode.segments[0].shots[0].dialogue = [];
    expect(validate(project).map((issue) => issue.code)).toContain('TRANSITION_PREMISE');
  });
});
