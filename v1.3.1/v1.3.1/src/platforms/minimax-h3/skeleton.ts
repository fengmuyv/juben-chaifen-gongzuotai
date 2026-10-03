import { activeEpisode, episodeOfShot, type Episode, type Project, type Shot } from '../../core/model';

export const fields = [
  { key: 'character', label: '人物参考图的描述' },
  { key: 'scene', label: '场景参考图的描述' },
  { key: 'scale', label: '景别' }, { key: 'composition', label: '构图' }, { key: 'lens', label: '焦距' },
  { key: 'movement', label: '运镜' }, { key: 'light', label: '光源' }, { key: 'atmosphere', label: '氛围' },
  { key: 'blocking', label: '人物站位 + 朝向' }, { key: 'action', label: '肢体动作（方位/动线）' },
  { key: 'performance', label: '微表情' }, { key: 'dialogue', label: '台词 / 内心OS' },
  { key: 'sound', label: '音效' }, { key: 'transition', label: '衔接' },
] as const;
export type EditableShotKey = Exclude<(typeof fields)[number]['key'], 'character' | 'scene' | 'dialogue'>;

/** 一键生成可填充的 10 条导演字段（③⑤⑥⑦⑧⑨⑩⑪⑬⑭）。 */
export const generatedKeys = ['scale', 'composition', 'lens', 'movement', 'light', 'atmosphere', 'blocking', 'action', 'performance', 'sound', 'transition'] as const;
export type GeneratedKey = (typeof generatedKeys)[number];

/** 禁改的 4 条：①②④ 来自参考图与文字设定，⑫ 来自原稿，一律不得由生成通道改写。 */
export const protectedKeys = ['character', 'scene', 'dialogue'] as const;

export function isGeneratedKey(key: string): key is GeneratedKey {
  return (generatedKeys as readonly string[]).includes(key);
}

/**
 * 定位镜头所属集：先按对象引用命中（镜头编号跨集重复，按 id 匹配会取错集），
 * 引用未命中再回退按 id 扫描，最后退回当前集，保持原语义。常见路径只扫当前集。
 */
function locateEpisode(project: Project, shot: Shot): Episode {
  const active = activeEpisode(project);
  const holds = (episode: Episode) => episode.segments.some((segment) => segment.shots.includes(shot));
  if (holds(active)) return active;
  return project.episodes.find(holds) ?? episodeOfShot(project, shot.id) ?? active;
}

/** 字段取值的唯一正本：按镜所属集注入参考图描述与道具信息。 */
export function values(project: Project, shot: Shot): string[] {
  const episode = locateEpisode(project, shot);
  const segment = episode.segments.find((item) => item.shots.some((entry) => entry.id === shot.id));
  const selected = episode.images.filter((image) => segment?.imageIds.includes(image.id) && image.confirmed);
  return fields.map(({ key }) => {
    if (key === 'character' || key === 'scene') {
      const descriptions = selected.filter((image) => image.kind === key).map((image) => image.description.trim());
      return descriptions.length ? descriptions.join('；') : project.visual[key] ? `文字设定：${project.visual[key]}` : '';
    }
    if (key === 'dialogue') return shot.dialogue.map((item) => item.kind === 'inner' ? `内心OS：${item.text}` : item.kind === 'narration' ? `旁白：${item.text}` : `${item.speaker}：${item.text}`).join('\n') || '无';
    if (key === 'composition') {
      const props = selected.filter((image) => image.kind === 'prop').map((image) => image.description.trim());
      return [shot.composition, ...props].filter(Boolean).join('；');
    }
    return shot[key];
  });
}
