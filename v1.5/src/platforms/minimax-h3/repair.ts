import type { Episode, Project, Segment, Shot } from '../../core/model';
import { activeScript } from '../../core/model';
import { planEpisode } from '../../core/planner';
import { parseScript } from '../../core/parser';

export type RepairResult = { project: Project; repairedEpisodes: string[]; unresolved: string[] };

function sourceText(project: Project, episode: Episode): string | null {
  const text = activeScript(project).text;
  if (episode.sourceRange) return text.slice(episode.sourceRange.start, episode.sourceRange.end);
  return project.episodes.length === 1 ? text : null;
}

function preserveShot(old: Shot | undefined, next: Shot): Shot {
  if (!old) return next;
  return {
    ...next,
    purpose: old.purpose, scale: old.scale, composition: old.composition, lens: old.lens,
    movement: old.movement, light: old.light, atmosphere: old.atmosphere, blocking: old.blocking,
    action: old.action, performance: old.performance, sound: old.sound, transition: old.transition,
    locked: old.locked, draftSource: old.draftSource,
  };
}

function repairEpisode(project: Project, episode: Episode): { episode: Episode; changed: boolean; unresolved: string[] } {
  const text = sourceText(project, episode);
  if (text === null) return { episode, changed: false, unresolved: [`${episode.label} 缺少可定位的原稿范围`] };
  const parsed = parseScript(text);
  const planned = planEpisode(text, project.defaultMode);
  const oldShots = new Map<string, Shot>();
  episode.segments.flatMap((segment) => segment.shots).forEach((shot) => shot.beatIds.forEach((id) => oldShots.set(id, shot)));
  const oldSegments = new Map<string, Segment>();
  episode.segments.forEach((segment) => segment.beatIds.forEach((id) => oldSegments.set(id, segment)));
  const segments = planned.segments.map((segment) => {
    const old = oldSegments.get(segment.beatIds[0]);
    const shots = segment.shots.map((shot) => preserveShot(oldShots.get(shot.beatIds[0]), shot));
    return {
      ...segment, shots, imageIds: old?.imageIds ?? [],
      confirmed: false, directorGenerated: shots.some((shot) => !!shot.draftSource),
    };
  });
  const repaired: Episode = {
    ...episode, scenes: planned.scenes, beats: planned.beats, segments,
    splitVerified: false, confirmed: false,
  };
  const changed = JSON.stringify({ scenes: episode.scenes, beats: episode.beats, segments: episode.segments.map((s) => ({ ...s, shots: s.shots.map((x) => ({ ...x, purpose: undefined, scale: undefined, composition: undefined, lens: undefined, movement: undefined, light: undefined, atmosphere: undefined, blocking: undefined, action: undefined, performance: undefined, sound: undefined, transition: undefined })) })) })
    !== JSON.stringify({ scenes: repaired.scenes, beats: repaired.beats, segments: repaired.segments.map((s) => ({ ...s, shots: s.shots.map((x) => ({ ...x, purpose: undefined, scale: undefined, composition: undefined, lens: undefined, movement: undefined, light: undefined, atmosphere: undefined, blocking: undefined, action: undefined, performance: undefined, sound: undefined, transition: undefined })) })) });
  return { episode: repaired, changed, unresolved: parsed.beats.length ? [] : [`${episode.label} 原稿未解析出节拍`] };
}

export function repairProject(project: Project, episodeId?: string): RepairResult {
  const targets = episodeId ? project.episodes.filter((episode) => episode.id === episodeId) : project.episodes;
  const repairedEpisodes = targets.map((episode) => repairEpisode(project, episode));
  const repairedIds = repairedEpisodes.filter((item) => item.changed).map((item) => item.episode.id);
  const byId = new Map(repairedEpisodes.map((item) => [item.episode.id, item.episode]));
  return {
    project: { ...project, episodes: project.episodes.map((episode) => byId.get(episode.id) ?? episode) },
    repairedEpisodes: repairedIds,
    unresolved: repairedEpisodes.flatMap((item) => item.unresolved),
  };
}
