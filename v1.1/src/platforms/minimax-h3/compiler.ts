import { type Project } from '../../core/model';
import { fields, values } from './skeleton';
import { validate } from './validator';

export function previewText(project: Project): string {
  const lines = [`${project.title} · ${project.episode} 分镜脚本`, ''];
  for (const segment of project.segments) {
    const scene = project.scenes.find((item) => item.id === segment.sceneId);
    lines.push(`${segment.id}｜15秒｜${segment.mode === 'dialogue' ? '文戏' : '武戏'}｜${scene?.title ?? ''}`, '');
    for (const shot of segment.shots) {
      lines.push(`${shot.id}【${shot.purpose || '待确认'}｜${shot.duration}s】`);
      values(project, shot).forEach((value, i) => lines.push(`${String.fromCharCode(0x2460 + i)} ${fields[i].label}：${value.replace(/\r?\n/g, ' / ') || '待确认'}`));
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function exportBundle(project: Project) {
  const report = validate(project);
  const errors = report.filter((item) => item.severity === 'error');
  if (errors.length) throw new Error(`交付已阻断：${errors.length}项错误`);
  const snapshot = JSON.stringify({ project, validation: report }, null, 2);
  return { text: previewText(project), snapshot, report };
}
