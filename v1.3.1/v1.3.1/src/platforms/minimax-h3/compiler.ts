import { activeEpisode, type Episode, type Project } from '../../core/model';
import { fields, values } from './skeleton';
import { validate } from './validator';

function pick(project: Project, episodeId?: string): Episode {
  return episodeId ? project.episodes.find((item) => item.id === episodeId) ?? activeEpisode(project) : activeEpisode(project);
}

export function previewText(project: Project, episodeId?: string): string {
  const episode = pick(project, episodeId);
  const lines = [`${project.title} · ${episode.label} 分镜脚本`, ''];
  for (const segment of episode.segments) {
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

export function exportBundle(project: Project, episodeId?: string) {
  const episode = pick(project, episodeId);
  const report = validate(project, episode.id);
  const errors = report.filter((item) => item.severity === 'error');
  if (errors.length) throw new Error(`交付已阻断：${errors.length}项错误`);
  const snapshot = JSON.stringify({ project, episodeId: episode.id, validation: report }, null, 2);
  return { text: previewText(project, episode.id), snapshot, report };
}
