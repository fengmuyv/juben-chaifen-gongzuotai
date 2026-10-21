import { activeEpisode, segmentsOf, type Episode, type Project } from '../../core/model';
import { fields, values } from './skeleton';
import { validate } from './validator';

function pick(project: Project, episodeId?: string): Episode {
  return episodeId ? project.episodes.find((item) => item.id === episodeId) ?? activeEpisode(project) : activeEpisode(project);
}

export function previewText(project: Project, episodeId?: string, segmentId?: string): string {
  const episode = pick(project, episodeId);
  const scope = segmentId ? `${episode.label} ${segmentId}` : episode.label;
  const lines = [`${project.title} · ${scope} 分镜脚本`, ''];
  for (const segment of segmentsOf(episode, segmentId)) {
    const scene = episode.scenes.find((item) => item.id === segment.sceneId);
    lines.push(`${segment.id}｜15秒｜${segment.mode === 'dialogue' ? '文戏' : '武戏'}｜${scene?.title ?? ''}`, '');
    for (const shot of segment.shots) {
      lines.push(`${shot.id}【${shot.purpose || '待确认'}｜${shot.duration}s】`);
      values(project, shot).forEach((value, i) => lines.push(`${String.fromCharCode(0x2460 + i)} ${fields[i].label}：${value.replace(/\r?\n/g, ' / ') || '待确认'}`));
      lines.push('');
    }
  }
  return lines.join('\n');
}

/**
 * 导出前置：校验 → 快照 → 文本。
 *
 * **片段口径（`segmentId` 非空）的闸门** = 本段 error ＋ **无 `segmentId` 的集级 error**。
 * 后者是原稿层的事实类闸门（`SOURCE_STRUCTURE` / `DIALOGUE_PROTECTION` / `BEAT_COVERAGE` 等）——
 * 它们拦的是「整份原稿已与分镜对不上」，与「别的段还没弄好」不是一回事，
 * 故不得因为导一片而被其他段拖住；反之原稿层已坏时，任何片段都不该放行。
 */
export function exportBundle(project: Project, episodeId?: string, segmentId?: string) {
  const episode = pick(project, episodeId);
  const report = validate(project, episode.id);
  const errors = report.filter((item) => item.severity === 'error' && (!segmentId || !item.segmentId || item.segmentId === segmentId));
  if (errors.length) throw new Error(`交付已阻断：${errors.length}项错误`);
  const snapshot = JSON.stringify({ project, episodeId: episode.id, segmentId: segmentId ?? null, validation: report }, null, 2);
  return { text: previewText(project, episode.id, segmentId), snapshot, report };
}
