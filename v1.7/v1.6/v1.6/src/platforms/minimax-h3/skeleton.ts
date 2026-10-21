import { activeEpisode, episodeOfShot, type Episode, type Project, type Shot } from '../../core/model';
import { skeletonFields, skeletonGeneratedKeys, skeletonProtectedKeys } from './skill-default';

/**
 * 14 格骨架正本已收拢到 `skill-default.ts`（P1 · 判据 JSON 化），此处只做再导出 ——
 * 既有 import 路径与类型推导（`EditableShotKey` / `GeneratedKey`）一律不变。
 */

export const fields = skeletonFields;
export type EditableShotKey = Exclude<(typeof fields)[number]['key'], 'character' | 'scene' | 'dialogue'>;

/** 一键生成可填充的 11 条导演字段（③④⑤⑥⑦⑧⑨⑩⑪⑬⑭）；④ 构图与 ⑨ 站位同源生成。 */
export const generatedKeys = skeletonGeneratedKeys;
export type GeneratedKey = (typeof generatedKeys)[number];

/** 禁改的 3 条：①② 来自参考图与文字设定，⑫ 来自原稿，一律不得由生成通道改写。 */
export const protectedKeys = skeletonProtectedKeys;

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

/** 字段取值的唯一正本：按镜所属集注入参考图描述。 */
export function values(project: Project, shot: Shot): string[] {
  const episode = locateEpisode(project, shot);
  const segment = episode.segments.find((item) => item.shots.some((entry) => entry.id === shot.id));
  // 资产库是项目级单源：本段绑定 → 资产库查表（本集视图不再另存一份图）。
  // 可用性判据 = **描述非空**（2026-10-05 取消人工确认）：两类资产一律填了描述即进 ①②，
  // 空描述的图虽被绑定也当没有，不回退成图号占位。
  // 2026-10-06：「道具」图类退役，④ 构图**不再拼接道具描述** —— 本函数只认人物 / 场景两类。
  const selected = project.assets.filter((image) => segment?.imageIds.includes(image.id) && !!image.description.trim());
  return fields.map(({ key }) => {
    if (key === 'character' || key === 'scene') {
      const descriptions = selected.filter((image) => image.kind === key).map((image) => image.description.trim());
      return descriptions.length ? descriptions.join('；') : project.visual[key] ? `文字设定：${project.visual[key]}` : '';
    }
    if (key === 'dialogue') return shot.dialogue.map((item) => item.kind === 'inner' ? `内心OS：${item.text}` : item.kind === 'narration' ? `旁白：${item.text}` : `${item.speaker}：${item.text}`).join('\n') || '无';
    return shot[key];
  });
}
