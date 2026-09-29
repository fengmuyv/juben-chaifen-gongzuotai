import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/core/planner';
import { effectiveLength, parseScript } from '../../src/core/parser';
import { exportBundle, previewText } from '../../src/platforms/minimax-h3/compiler';
import { fields } from '../../src/platforms/minimax-h3/skeleton';
import { validate } from '../../src/platforms/minimax-h3/validator';
import { readWord, writeWord } from '../../src/core/word';
import { describeImage } from '../../electron/vision';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const script = `# 第一场 室内
甲：你看见那封信了吗？
乙：我没有打开。
甲走向桌边。`;

function completedProject() {
  const project = createProject(script);
  project.visual = { ...project.visual, character: '甲穿白衣，乙穿黑衣', scene: '桌子位于北墙', confirmed: true };
  for (const segment of project.segments) {
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
    expect(project.segments.length).toBe(2);
    expect(project.segments.every((segment) => segment.duration === 15 && segment.shots.reduce((sum, shot) => sum + shot.duration, 0) === 15)).toBe(true);
    expect(project.segments.flatMap((segment) => segment.shots.map((shot) => shot.id))).toEqual(['SC01', 'SC02', 'SC03', 'SC04', 'SC05', 'SC06']);
  });
  it('leaves director details unconfirmed and blocks export', () => {
    const project = createProject(script);
    expect(validate(project).some((issue) => issue.code === 'DIRECTOR_UNCONFIRMED')).toBe(true);
    expect(() => exportBundle(project)).toThrow('交付已阻断');
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
    expect(lines).toHaveLength(project.segments.flatMap((segment) => segment.shots).length * 14);
    expect(lines.slice(0, 14).map((line, index) => line.startsWith(`${String.fromCharCode(0x2460 + index)} ${fields[index].label}：`))).toEqual(Array(14).fill(true));
    expect(previewText(project)).toBe(result.text);
    expect(result.text).not.toContain('# ');
  });
  it('blocks duration, numbering, missing fields, placeholder and dialogue mutation', () => {
    const project = completedProject();
    project.segments[0].shots[0].duration = 7;
    project.segments[0].shots[1].id = 'SC09';
    project.segments[0].shots[0].scale = '';
    project.visual.scene = '<Picture 1>';
    project.segments[0].shots[0].dialogue[0].text = '擅改台词';
    const codes = validate(project).map((issue) => issue.code);
    for (const code of ['DURATION', 'SHOT_NUMBER', 'FIELD_REQUIRED', 'IMAGE_PLACEHOLDER', 'DIALOGUE_PROTECTION']) expect(codes).toContain(code);
    expect(() => exportBundle(project)).toThrow();
  });
  it('blocks missing source beat coverage and overlong dialogue', () => {
    const project = completedProject();
    project.segments[0].beatIds.pop();
    expect(validate(project).map((issue) => issue.code)).toContain('BEAT_COVERAGE');
    const long = createProject(`甲：${'一'.repeat(49)}`);
    expect(validate(long).map((issue) => issue.code)).toContain('DIALOGUE_LIMIT');
  });
  it('reports character drift and continuity changes that lack a handoff', () => {
    const project = createProject(`${script}\n# 第二场 走廊\n甲：走。`);
    project.visual = { ...project.visual, character: '甲穿白衣，乙穿黑衣', scene: '桌子位于北墙', confirmed: true };
    for (const segment of project.segments) {
      segment.confirmed = true;
      for (const shot of segment.shots) Object.assign(shot, {
        purpose: '确认连续性', scale: '中景', composition: '双人分列', lens: '50mm', movement: '静止', light: '北侧窗光',
        atmosphere: '空间安静', blocking: '甲在桌南，乙在门侧', action: '甲观察信封', performance: '甲目光停在信封', sound: '脚步声', transition: '保持轴线，接下一镜视线',
      });
    }
    const secondSegment = project.segments[1];
    const secondImage = { id: 'b'.repeat(64), sha256: 'b'.repeat(64), name: '人物-变化.png', dataUrl: 'data:image/png;base64,AA==', kind: 'character' as const, description: '甲穿蓝衣，短发', confirmed: true, version: 1 };
    project.images.push(secondImage);
    secondSegment.imageIds.push(secondImage.id);
    const first = project.segments[0].shots.at(-1)!;
    const second = project.segments[1].shots[0];
    first.transition = '情绪延续';
    second.blocking = '乙移动到窗边，背向甲';
    second.composition = '人物位于右三分之一';
    second.light = '南侧暖光';
    project.visual.character = '甲穿红衣，乙穿黑衣';
    const codes = validate(project).map((issue) => issue.code);
    expect(codes).toContain('BLOCKING_CONTINUITY');
    expect(codes).toContain('COMPOSITION_CONTINUITY');
    expect(codes).toContain('LIGHT_CONTINUITY');
    expect(codes).toContain('CHARACTER_CONTINUITY');
    expect(codes).toContain('CHARACTER_ANCHOR_DRIFT');
    expect(() => exportBundle(project)).toThrow('交付已阻断');
    expect(exportBundle(completedProject()).text).not.toContain('质检报告');
  });
});

describe('图片描述与 Word', () => {
  it('uses only confirmed descriptions selected for a segment and enforces six references', () => {
    const project = completedProject();
    const segment = project.segments[0];
    const image = { id: 'a'.repeat(64), sha256: 'a'.repeat(64), name: '人物.png', dataUrl: 'data:image/png;base64,AA==', kind: 'character' as const, description: '黑发、左眼下有痣', confirmed: false, version: 1 };
    project.images.push(image);
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

  it('sends image data to configured model and rejects non-local HTTP', async () => {
    const originalFetch = globalThis.fetch;
    let sent: { model: string; messages: { content: { type: string }[] }[] } | undefined;
    globalThis.fetch = async (_url, options) => { sent = JSON.parse(String(options?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '可见黑发和白色衣领' } }] }), { status: 200 }); };
    try {
      const input = { endpoint: 'https://example.test/v1/chat/completions', model: 'vision', apiKey: 'test', image: { kind: 'character', dataUrl: 'data:image/png;base64,AA==' } };
      expect(await describeImage(input)).toBe('可见黑发和白色衣领');
      expect(sent?.model).toBe('vision');
      expect(sent?.messages[0].content.map((part) => part.type)).toEqual(['text', 'image_url']);
      await expect(describeImage({ ...input, endpoint: 'http://example.test/v1/chat/completions' })).rejects.toThrow('HTTPS');
    } finally { globalThis.fetch = originalFetch; }
  });
});
