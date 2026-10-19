import type { Beat, DefaultMode, Episode, Mode, Project, Shot } from './model';
import { activeEpisode } from './model';
import { effectiveLength, isBriefHeadingLine, parseScript, parserVersion } from './parser';
import { splitEpisodes, type EpisodeSplitResult } from './episodes';
import { allocateShotDurations, segmentDuration } from './timing';

/** 说明文档识别：加粗元数据行与非正文块标题合计 ≥3，且没有任何确凿台词行。 */
export function isMarkdownBrief(text: string): boolean {
  const lines = text.split('\n');
  const metadata = lines.filter((line) => /^\s*\*\*[^*]+[:：]\*\*/u.test(line) || isBriefHeadingLine(line)).length;
  const hasScript = lines.some((line) => /^\s*(?:[^#：:*]{1,20}[：:]\s*\S|(?:内心|旁白|OS)[：:])/u.test(line));
  return metadata >= 3 && !hasScript;
}

function inferredMode(beat: Beat, mode: DefaultMode): Mode {
  if (mode !== 'combined') return mode;
  return beat.kind === 'action' && /挥|踢|砍|格挡|刺|扑|打斗|出拳|撞|摔|追击/u.test(beat.text) ? 'action' : 'dialogue';
}

/** 单集拆段：原 v1.0 规划逻辑，适配为集内上下文。 */
export function planEpisode(text: string, defaultMode: DefaultMode): Pick<Episode, 'scenes' | 'beats' | 'segments'> {
  const parsed = parseScript(text);
  if (!parsed.beats.length) {
    return { scenes: parsed.scenes, beats: [], segments: [] };
  }
  const groups: { mode: Mode; beats: Beat[] }[] = [];
  for (const beat of parsed.beats) {
    const previous = groups.at(-1);
    const mode = inferredMode(beat, defaultMode);
    const dialogueCount = previous?.beats.reduce((sum, item) => sum + effectiveLength(item.dialogue?.text ?? ''), 0) ?? 0;
    if (!previous || previous.mode !== mode || previous.beats[0].sceneId !== beat.sceneId || previous.beats.length >= 5 || dialogueCount + effectiveLength(beat.dialogue?.text ?? '') > 44) {
      groups.push({ mode, beats: [beat] });
    } else previous.beats.push(beat);
  }
  let shotNumber = 0;
  const segments = groups.map((group, index) => {
    const count = Math.max(3, group.beats.length);
    const shots: Shot[] = Array.from({ length: count }, (_, i) => {
      const beat = group.beats[i];
      const number = ++shotNumber;
      return {
        id: `SC${String(number).padStart(2, '0')}`, duration: 0,
        beatIds: beat ? [beat.id] : [], dialogue: beat?.dialogue ? [beat.dialogue] : [], purpose: '', scale: '', composition: '', lens: '', movement: '',
        light: '', atmosphere: '', blocking: '', action: '', performance: '', sound: '', transition: '', locked: false,
      };
    });
    // 时长统一由分配器决定（段内各镜之和 = 15 秒、单镜 ≤ 12 秒）；下面立即回填，不会外泄 0。
    allocateShotDurations(shots).forEach((duration, i) => { shots[i].duration = duration; });
    return { id: `P${String(index + 1).padStart(2, '0')}`, sceneId: group.beats[0].sceneId, mode: group.mode, duration: segmentDuration, beatIds: group.beats.map((beat) => beat.id), shots, confirmed: false, directorGenerated: false, imageIds: [] };
  });
  return { scenes: parsed.scenes, beats: parsed.beats, segments };
}

/** 整本剧本 → 集数组（含分集识别结果）。资产库在项目级，集里只留绑定与匹配结论。 */
export function buildEpisodes(text: string, defaultMode: DefaultMode): { episodes: Episode[]; split: EpisodeSplitResult } {
  const split = splitEpisodes(text);
  const episodes: Episode[] = split.episodes.map((item, position) => ({
    id: `ep-${String(position + 1).padStart(2, '0')}`, label: item.label, index: item.index,
    sourceRange: { start: item.start, end: item.end },
    ...planEpisode(item.text, defaultMode), imageMatches: {}, confirmed: false, splitVerified: false,
  }));
  return { episodes, split };
}

export function planProject(text: string, defaultMode: DefaultMode): Pick<Project, 'episodes' | 'activeEpisodeId' | 'parserVersion'> {
  const { episodes } = buildEpisodes(text, defaultMode);
  return { episodes, activeEpisodeId: episodes[0].id, parserVersion };
}

/**
 * 用当前原稿与**当前解析口径**重建分集与拆段。保留 project 级字段（visual / scripts / 类型 / 模式 / **资产库**），
 * 并尽量停在原来的集号位置。
 *
 * 单一来源：`replan()`（用户主动）与 `reconcileSplit()`（口径升级后自动）共用此函数 ——
 * 两者若各写一套重建逻辑，早晚会出现「手动点重建是对的、自动重建是错的」这类分叉。
 *
 * 资产库（`project.assets`）是**项目级**字段，随 `...project` 展开原样保留 ——
 * 重建分集与资产无关，**不得**因为重建而丢弃用户导入的资产。
 * 段级 `imageIds` 会随段重建而失效（用户在界面上按段重新绑定或重新生成即可），
 * 但资产本体、描述、确认状态与内置分析完整保留；`imageMatches` 亦按集保留。
 */
export function rebuildEpisodes(project: Project): Project {
  const script = project.scripts.find((item) => item.id === project.activeScriptId) ?? project.scripts[0];
  const planned = planProject(script.text, project.defaultMode);
  const keep = activeEpisode(project).index;
  const matchesByIndex = new Map(project.episodes.map((episode) => [episode.index, episode.imageMatches]));
  const episodes = planned.episodes.map((episode) => {
    const matches = matchesByIndex.get(episode.index);
    return matches && Object.keys(matches).length ? { ...episode, imageMatches: matches } : episode;
  });
  const target = episodes.find((episode) => episode.index === keep) ?? episodes[0];
  return { ...project, ...planned, episodes, activeEpisodeId: target.id };
}

/**
 * 项目是否已产生**用户内容** —— 「解析口径升级后可否自动重建分集」的唯一安全判据。
 *
 * 只要任一项为真，自动重建就会**毁掉用户的东西**（导演板字段 / 参考图 / 人工确认 / 锁定镜头），
 * 因此此时只做「可见提示」，把决定权交给用户。
 *
 * 口径宁可宽：多算一项只是「少一次自动重建、多一次提示」，代价远小于误重建。
 */
export function hasUserContent(project: Project): boolean {
  if (project.scripts.length > 1) return true; // 存过原稿版本
  if (project.visual.character.trim() || project.visual.scene.trim()) return true;
  if (project.assets.length > 0) return true; // 导入过资产：重建分集不得擅自丢掉用户的资产库
  return project.episodes.some((episode) =>
    episode.confirmed || episode.splitVerified ||
    episode.segments.some((segment) =>
      segment.confirmed || segment.directorGenerated ||
      segment.shots.some((shot) =>
        shot.locked || shot.purpose.trim() || shot.scale.trim() || shot.composition.trim() ||
        shot.lens.trim() || shot.movement.trim() || shot.light.trim() || shot.atmosphere.trim() ||
        shot.blocking.trim() || shot.action.trim() || shot.performance.trim() ||
        shot.sound.trim() || shot.transition.trim())));
}

export type SplitReconcile = {
  project: Project;
  /** current：口径一致；rebuilt：旧口径且无用户内容，已按新口径重建；stale：旧口径但有用户内容，仅提示。 */
  status: 'current' | 'rebuilt' | 'stale';
  /** 重建/提示发生时的口径迁移方向，供界面文案与测试断言。 */
  from: string;
  to: string;
};

/**
 * 打开存档时的**解析口径对账**：解决「升级了识别口径，但已存存档不会自动重算」这个静默不一致。
 *
 * - 一致 → 原样返回；
 * - 不一致且**无用户内容** → 自动重建分集（安全，且是用户真正期待的「打开就该对」）；
 * - 不一致但**有用户内容** → 不碰数据，返回 `stale`，由界面提示用户手动重建。
 *
 * 绝不静默：两种非一致分支都会把 `status` 交给界面显示。
 */
export function reconcileSplit(project: Project): SplitReconcile {
  const from = project.parserVersion ?? '（无·旧存档）';
  if (project.parserVersion === parserVersion) return { project, status: 'current', from: parserVersion, to: parserVersion };
  if (hasUserContent(project)) return { project, status: 'stale', from, to: parserVersion };
  return { project: rebuildEpisodes(project), status: 'rebuilt', from, to: parserVersion };
}

export function createProject(text: string, title = '未命名作品', defaultMode: DefaultMode = 'combined'): Project {
  return {
    schemaVersion: 2, id: crypto.randomUUID(), title, contentType: 'short-drama', defaultMode,
    platform: 'minimax-h3', compilerVersion: '0.2.0', skeletonVersion: '1.0.0',
    scripts: [{ id: 'script-1', text, filename: '手动输入' }], activeScriptId: 'script-1',
    assets: [],
    ...planProject(text, defaultMode),
    visual: { version: 1, character: '', scene: '', source: 'manual', confirmed: false },
  };
}
