import { activeEpisode, activeScript, type Episode, type Issue, type Project } from '../../core/model';
import { parseScript, effectiveLength } from '../../core/parser';
import { auditEpisodeContent } from './audit';
import { issuePolicy, issueCategoryNames, shotDuration, transitionForbiddenPattern, transitionForbiddenWords, type IssueCode } from './rules';
import { fields, values } from './skeleton';

// 闸门规则正本已下沉到 `rules.ts`（叶子模块，避免 audit / director / validator 三方成环）。
// 这里原样再导出，保持既有 import 路径不变。
export { issuePolicy, issueCategoryNames, shotDuration, transitionForbiddenPattern, transitionForbiddenWords };
export type { IssueCode };

function episodeSource(project: Project, episode: Episode): string | null {
  const script = activeScript(project).text;
  if (episode.sourceRange) return script.slice(episode.sourceRange.start, episode.sourceRange.end);
  return project.episodes.length === 1 ? script : null;
}

export function validate(project: Project, episodeId?: string): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, message: string, segmentId?: string, shotId?: string) => {
    issues.push({ code, message, segmentId, shotId, ...issuePolicy[code] });
  };
  const episode = episodeId ? project.episodes.find((item) => item.id === episodeId) ?? activeEpisode(project) : activeEpisode(project);
  let source: string;
  try { source = activeScript(project).text; } catch { add('SOURCE_VERSION', '原稿版本引用不存在'); return issues; }

  if (!episode.splitVerified) add('EPISODE_SPLIT_UNVERIFIED', `${episode.label} 分集结果尚未人工核对，请确认集清单与切点行号`);
  if (!episode.segments.length) add('EMPTY', '没有可交付段落');
  if (!project.visual.confirmed && !episode.images.some((image) => image.confirmed && image.kind === 'character')) add('VISUAL_UNCONFIRMED', '人物固定锚点或人物参考图描述尚未确认');

  const episodeText = episodeSource(project, episode);
  if (episodeText !== null) {
    const parsed = parseScript(episodeText);
    if (JSON.stringify(parsed.beats) !== JSON.stringify(episode.beats) || JSON.stringify(parsed.scenes) !== JSON.stringify(episode.scenes)) add('SOURCE_STRUCTURE', '场次或节拍与原稿不一致');
    const expected = parsed.beats.flatMap((beat) => beat.dialogue ? [beat.dialogue] : []);
    const actual = episode.segments.flatMap((segment) => segment.shots.flatMap((shot) => shot.dialogue));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) add('DIALOGUE_PROTECTION', '原台词、说话人、顺序或原文位置被修改或遗漏');
    const assigned = episode.segments.flatMap((segment) => segment.beatIds);
    if (JSON.stringify(assigned) !== JSON.stringify(parsed.beats.map((beat) => beat.id))) add('BEAT_COVERAGE', '原稿节拍遗漏、重复或乱序');
  } else {
    const actual = episode.segments.flatMap((segment) => segment.shots.flatMap((shot) => shot.dialogue));
    const assigned = episode.segments.flatMap((segment) => segment.beatIds);
    const expected = episode.beats.flatMap((beat) => beat.dialogue ? [beat.dialogue] : []);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) add('DIALOGUE_PROTECTION', '原台词、说话人、顺序或原文位置被修改或遗漏');
    if (JSON.stringify(assigned) !== JSON.stringify(episode.beats.map((beat) => beat.id))) add('BEAT_COVERAGE', '原稿节拍遗漏、重复或乱序');
  }

  // 参考图自动匹配置信度与未分配项（阶段 C 闸门）。
  const boundImageIds = new Set(episode.segments.flatMap((segment) => segment.imageIds));
  if (episode.images.some((image) => image.matchConfidence === 'low')) add('AUTO_MATCH_LOW_CONFIDENCE', '存在低置信度匹配的参考图，需人工指定归属');
  if (episode.images.some((image) => image.matchConfidence && !boundImageIds.has(image.id))) add('AUTO_MATCH_LOW_CONFIDENCE', '存在已入库但未绑定到任何段落的参考图，请在未分配区处理');

  let number = 0;
  const orderedShots = episode.segments.flatMap((segment) => segment.shots.map((shot) => ({ segment, shot })));
  let previous: { segment: Episode['segments'][number]; shot: Episode['segments'][number]['shots'][number] } | undefined;
  let previousCharacter = '';
  let previousCharacterAnchor: string | undefined;
  episode.segments.forEach((segment, index) => {
    if (segment.id !== `P${String(index + 1).padStart(2, '0')}`) add('SEGMENT_NUMBER', '段落编号不连续', segment.id);
    if (segment.duration !== 15) add('DURATION', '段落时长必须为15秒', segment.id);
    if (!segment.confirmed) add('DIRECTOR_UNCONFIRMED', segment.directorGenerated ? '导演决策已生成但尚未人工确认，请复核后确认本段' : '导演决策尚未生成，也未人工确认；请先执行生成或人工填写', segment.id);
    if (new Set(segment.imageIds).size > 6) add('IMAGE_LIMIT', '本段超过6张不同参考图片', segment.id);
    const segmentCharacterAnchor = segment.imageIds
      .map((id) => episode.images.find((image) => image.id === id))
      .filter((image): image is NonNullable<typeof image> => !!image && image.kind === 'character' && image.confirmed && !!image.description.trim())
      .map((image) => image.description.trim()).join('；') || (project.visual.confirmed ? project.visual.character.trim() : '');
    if (previousCharacterAnchor && segmentCharacterAnchor && previousCharacterAnchor !== segmentCharacterAnchor) add('CHARACTER_ANCHOR_DRIFT', '相邻段落已确认的人物固定描述发生漂移；请确认是否为换装、受伤或身份变化后再导出', segment.id);
    if (segmentCharacterAnchor) previousCharacterAnchor = segmentCharacterAnchor;
    for (const id of segment.imageIds) {
      const image = episode.images.find((item) => item.id === id);
      if (!image || !image.confirmed || !image.description.trim()) add('IMAGE_UNCONFIRMED', '引用的图片不存在或描述未确认', segment.id);
    }
    if (!episode.scenes.some((scene) => scene.id === segment.sceneId) || segment.beatIds.some((id) => episode.beats.find((beat) => beat.id === id)?.sceneId !== segment.sceneId)) add('SCENE_REFERENCE', '段落场次引用无效或跨场', segment.id);
    if (JSON.stringify(segment.shots.flatMap((shot) => shot.beatIds)) !== JSON.stringify(segment.beatIds)) add('SHOT_SOURCE', '镜头节拍映射遗漏、重复或乱序', segment.id);
    const dialogueLength = segment.shots.reduce((sum, shot) => sum + effectiveLength(shot.dialogue.map((item) => item.text).join('')), 0);
    if (dialogueLength > 48) add('DIALOGUE_LIMIT', `台词${dialogueLength}字，超过48字硬上限；请在自然分句处调整原稿版本`, segment.id);
    else if (dialogueLength > 44) add('DIALOGUE_LOAD', '台词接近上限，复核动作和停顿', segment.id);
    if (segment.shots.length > 5) add('SHOT_DENSITY', '镜头超过5个，复核密度', segment.id);
    if (segment.mode === 'action') add('ACTION_REVIEW', '武戏装备、能力和攻防因果需人工对照原稿验收', segment.id);
    for (const shot of segment.shots) {
      if (shot.id !== `SC${String(++number).padStart(2, '0')}`) add('SHOT_NUMBER', '镜头编号不连续', segment.id, shot.id);
      if (!Number.isFinite(shot.duration) || shot.duration !== shotDuration) add('SHOT_DURATION', `每条分镜时长必须为${shotDuration}秒`, segment.id, shot.id);
      const shotValues = values(project, shot);
      shotValues.forEach((value, i) => {
        if (!value.trim()) add('FIELD_REQUIRED', `缺少${fields[i].label}`, segment.id, shot.id);
        if (/<Picture\s*\d+>|@图片\d+|见参考图|参照上传图/iu.test(value)) add('IMAGE_PLACEHOLDER', '正文不能以图号代替具体描述', segment.id, shot.id);
      });
      if (transitionForbiddenPattern.test(shot.transition)) {
        const hit = transitionForbiddenWords.find((word) => shot.transition.includes(word));
        add('TRANSITION_FORBIDDEN', `衔接命中转场禁词「${hit}」，请改用动作接动作、视线引导、遮挡转场、J-Cut/L-Cut 等合规衔接`, segment.id, shot.id);
      }
      if (!shot.purpose.trim()) add('PURPOSE_REQUIRED', '缺少镜头导演意图', segment.id, shot.id);
      if (['切', '切。', '切换', '待确认', '待补充'].includes(shot.transition.trim())) add('TRANSITION', '衔接须说明下一镜或段的交棒事实', segment.id, shot.id);
      const character = shotValues[0].trim();
      if (!character) add('CHARACTER_ANCHOR', '缺少人物固定特征或本镜人物状态描述', segment.id, shot.id);
      if (previous) {
        const transition = previous.shot.transition.trim();
        const transitionHasAnchor = /接|承|保持|轴线|视线|交棒|转向|进入|离开|移动|声音|光源|构图|机位|下一镜|下一段/u.test(transition);
        if (previous.shot.blocking.trim() !== shot.blocking.trim() && !transitionHasAnchor) add('BLOCKING_CONTINUITY', '相邻镜头站位或朝向发生变化，但衔接未说明移动、轴线或视线交接', segment.id, shot.id);
        if (previous.shot.composition.trim() !== shot.composition.trim() && !transitionHasAnchor) add('COMPOSITION_CONTINUITY', '相邻镜头构图发生变化，但衔接未说明机位或构图交接', segment.id, shot.id);
        if (previous.shot.light.trim() !== shot.light.trim() && !transitionHasAnchor) add('LIGHT_CONTINUITY', '相邻镜头光源描述发生变化，但衔接未说明光线变化或合理转场', segment.id, shot.id);
        if (previousCharacter !== character) add('CHARACTER_CONTINUITY', '相邻镜头人物固定描述发生变化，请确认是否为换装、受伤或身份变化', segment.id, shot.id);
      }
      previous = { segment, shot };
      previousCharacter = character;
    }
  });
  if (orderedShots.length > 1 && orderedShots.some(({ shot }) => !shot.transition.trim())) add('CONTINUITY_REVIEW', '相邻镜段的道具、空间、表演和声音连续性仍需人工复核');
  // 通用一致性审计：与具体剧本无关，任何原稿生成后自动执行（不需要为每个项目单独升级）。
  for (const issue of auditEpisodeContent(project, episode)) add(issue.code, issue.message, issue.segmentId, issue.shotId);
  return issues;
}
