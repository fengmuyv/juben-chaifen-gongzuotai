import type { Project, Shot } from '../../core/model';

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

export function values(project: Project, shot: Shot): string[] {
  const segment = project.segments.find((item) => item.shots.some((entry) => entry.id === shot.id));
  const selected = project.images.filter((image) => segment?.imageIds.includes(image.id) && image.confirmed);
  return fields.map(({ key }) => {
    if (key === 'character' || key === 'scene') {
      const descriptions = selected.filter((image) => image.kind === key).map((image) => image.description.trim());
      return descriptions.length ? descriptions.join('；') : project.visual[key] ? `文字设定：${project.visual[key]}` : '';
    }
    if (key === 'dialogue') return shot.dialogue.map((item) => `${item.speaker}：${item.text}`).join('\n') || '无';
    if (key === 'composition') {
      const props = selected.filter((image) => image.kind === 'prop').map((image) => image.description.trim());
      return [shot.composition, ...props].filter(Boolean).join('；');
    }
    return shot[key];
  });
}
