import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/core/planner';
import { effectiveLength, parseScript } from '../../src/core/parser';
import { exportBundle, previewMarkdown } from '../../src/platforms/minimax-h3/compiler';
import { fields } from '../../src/platforms/minimax-h3/skeleton';
import { validate } from '../../src/platforms/minimax-h3/validator';

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
    expect(result.markdown).toContain('SC01【确认信封状态｜5s】');
    expect(fields).toHaveLength(14);
    const lines = result.markdown.split('\n').filter((line) => /^[①-⑭] /u.test(line));
    expect(lines).toHaveLength(project.segments.flatMap((segment) => segment.shots).length * 14);
    expect(lines.slice(0, 14).map((line, index) => line.startsWith(`${String.fromCharCode(0x2460 + index)} ${fields[index].label}：`))).toEqual(Array(14).fill(true));
    expect(previewMarkdown(project)).toBe(result.markdown);
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
});
