import { activeScript, type Issue, type Project } from '../../core/model';
import { parseScript, effectiveLength } from '../../core/parser';
import { fields, values } from './skeleton';

export function validate(project: Project): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, message: string, segmentId?: string, shotId?: string, severity: Issue['severity'] = 'error') => issues.push({ code, message, segmentId, shotId, severity });
  let source: string;
  try { source = activeScript(project).text; } catch { add('SOURCE_VERSION', '原稿版本引用不存在'); return issues; }
  if (!project.segments.length) add('EMPTY', '没有可交付段落');
  if (!project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim()) add('VISUAL_UNCONFIRMED', '文字视觉设定尚未完整确认');
  const parsed = parseScript(source);
  if (JSON.stringify(parsed.beats) !== JSON.stringify(project.beats) || JSON.stringify(parsed.scenes) !== JSON.stringify(project.scenes)) add('SOURCE_STRUCTURE', '场次或节拍与原稿不一致');
  const expected = parsed.beats.flatMap((beat) => beat.dialogue ? [beat.dialogue] : []);
  const actual = project.segments.flatMap((segment) => segment.shots.flatMap((shot) => shot.dialogue));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) add('DIALOGUE_PROTECTION', '原台词、说话人、顺序或原文位置被修改或遗漏');
  const assigned = project.segments.flatMap((segment) => segment.beatIds);
  if (JSON.stringify(assigned) !== JSON.stringify(parsed.beats.map((beat) => beat.id))) add('BEAT_COVERAGE', '原稿节拍遗漏、重复或乱序');
  let number = 0;
  project.segments.forEach((segment, index) => {
    if (segment.id !== `P${String(index + 1).padStart(2, '0')}`) add('SEGMENT_NUMBER', '段落编号不连续', segment.id);
    if (segment.duration !== 15 || Math.abs(segment.shots.reduce((sum, shot) => sum + shot.duration, 0) - 15) > 0.000001) add('DURATION', '段落及镜头时长之和必须为15秒', segment.id);
    if (!segment.confirmed) add('DIRECTOR_UNCONFIRMED', '导演决定和末帧交接尚未人工确认', segment.id);
    if (!project.scenes.some((scene) => scene.id === segment.sceneId) || segment.beatIds.some((id) => project.beats.find((beat) => beat.id === id)?.sceneId !== segment.sceneId)) add('SCENE_REFERENCE', '段落场次引用无效或跨场', segment.id);
    if (JSON.stringify(segment.shots.flatMap((shot) => shot.beatIds)) !== JSON.stringify(segment.beatIds)) add('SHOT_SOURCE', '镜头节拍映射遗漏、重复或乱序', segment.id);
    const dialogueLength = segment.shots.reduce((sum, shot) => sum + effectiveLength(shot.dialogue.map((item) => item.text).join('')), 0);
    if (dialogueLength > 48) add('DIALOGUE_LIMIT', `台词${dialogueLength}字，超过48字硬上限；请在自然分句处调整原稿版本`, segment.id);
    else if (dialogueLength > 44) add('DIALOGUE_LOAD', '台词接近上限，复核动作和停顿', segment.id, undefined, 'warning');
    if (segment.shots.length > 5) add('SHOT_DENSITY', '镜头超过5个，复核密度', segment.id, undefined, 'warning');
    if (segment.mode === 'action') add('ACTION_REVIEW', '武戏装备、能力和攻防因果需人工对照原稿验收', segment.id, undefined, 'warning');
    for (const shot of segment.shots) {
      if (shot.id !== `SC${String(++number).padStart(2, '0')}`) add('SHOT_NUMBER', '镜头编号不连续', segment.id, shot.id);
      if (!Number.isFinite(shot.duration) || shot.duration <= 0) add('SHOT_DURATION', '镜头时长必须为正数', segment.id, shot.id);
      values(project, shot).forEach((value, i) => {
        if (!value.trim()) add('FIELD_REQUIRED', `缺少${fields[i].label}`, segment.id, shot.id);
        if (/<Picture\s*\d+>|@图片\d+|见参考图|参照上传图/iu.test(value)) add('IMAGE_PLACEHOLDER', '正文不能以图号代替具体描述', segment.id, shot.id);
      });
      if (!shot.purpose.trim()) add('PURPOSE_REQUIRED', '缺少镜头导演意图', segment.id, shot.id);
      if (['切', '切。', '切换', '待确认', '待补充'].includes(shot.transition.trim())) add('TRANSITION', '衔接须说明下一镜或段的交棒事实', segment.id, shot.id);
    }
  });
  add('CONTINUITY_REVIEW', '相邻镜段的道具、空间、表演和声音连续性须人工复核；本版不宣称自动语义识别', undefined, undefined, 'warning');
  return issues;
}
