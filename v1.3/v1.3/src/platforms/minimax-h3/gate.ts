import type { Issue, Project } from '../../core/model';
import { validate } from './validator';

/** 挂上集归属的问题项：界面按集分组与跳转的唯一依据。 */
export type AuditedIssue = Issue & { episodeId: string; episodeLabel: string };

export type EpisodeAudit = {
  episodeId: string; label: string; index: number;
  errors: AuditedIssue[]; warnings: AuditedIssue[];
  /** 该集无任何阻断项即可单独导出。 */
  exportable: boolean;
};

export type ProjectAudit = {
  episodes: EpisodeAudit[];
  errors: AuditedIssue[];
  warnings: AuditedIssue[];
  /** 可导出集（按集顺序）。 */
  exportableEpisodes: EpisodeAudit[];
};

export function auditEpisode(project: Project, episodeId: string): EpisodeAudit {
  const episode = project.episodes.find((item) => item.id === episodeId) ?? project.episodes[0];
  const issues = validate(project, episode.id).map((issue) => ({ ...issue, episodeId: episode.id, episodeLabel: episode.label }));
  const errors = issues.filter((issue) => issue.severity === 'error');
  return {
    episodeId: episode.id, label: episode.label, index: episode.index,
    errors, warnings: issues.filter((issue) => issue.severity === 'warning'),
    exportable: errors.length === 0,
  };
}

/**
 * 全书审计：逐集给出阻断项与可导出判定。
 * 导出按钮不因任一条问题永久失效，由本结果决定「当前集可直接导出」还是「给出全书阻断清单」。
 */
export function auditProject(project: Project): ProjectAudit {
  const episodes = project.episodes.map((episode) => auditEpisode(project, episode.id));
  return {
    episodes,
    errors: episodes.flatMap((item) => item.errors),
    warnings: episodes.flatMap((item) => item.warnings),
    exportableEpisodes: episodes.filter((item) => item.exportable),
  };
}

/** 单集是否可导出（不传集号时判定当前集）。 */
export function canExportEpisode(project: Project, episodeId?: string): boolean {
  const target = episodeId ?? project.activeEpisodeId;
  return auditEpisode(project, target).exportable;
}
