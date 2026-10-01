import type { Episode, ImageAnalysis, MatchConfidence, MatchSource } from './model';
import type { Roster as SubjectRoster } from './analyze';

export type SceneEntry = { sceneId: string; title: string; keywords: string[] };
export type EpisodeRoster = { characters: string[]; scenes: SceneEntry[] };

/** 场景标题去噪：剥掉「第N场 / 内 / 外 / INT. / EXT.」后按分隔符切词，取长度 ≥ 2 的片段。 */
export function sceneKeywords(title: string): string[] {
  const stripped = title
    .replace(/^#+\s*/u, '')
    .replace(/^第\s*[^\s]{1,12}场/u, '')
    .replace(/^[（(]?\s*(?:内景|外景|室内|室外|内|外|INT|EXT)[.．、:：]?\s*[)）]?/iu, '');
  const parts = stripped.split(/[·\-_\s/|,，、（）()［］\[\]]+/u).map((part) => part.trim()).filter((part) => [...part].length >= 2);
  return [...new Set(parts)];
}

/** 从集内原稿抽取说话人名册与场景名册。 */
export function buildRoster(episode: Episode): EpisodeRoster {
  const characters = [...new Set(episode.beats.map((beat) => beat.dialogue?.speaker).filter((speaker): speaker is string => !!speaker && !!speaker.trim()))];
  const scenes: SceneEntry[] = episode.scenes.map((scene) => ({ sceneId: scene.id, title: scene.title, keywords: sceneKeywords(scene.title) }));
  return { characters, scenes };
}

export function subjectRoster(roster: EpisodeRoster): SubjectRoster {
  return { characters: roster.characters, scenes: [...new Set(roster.scenes.flatMap((scene) => scene.keywords))] };
}

export type MatchOutcome = {
  imageId: string;
  subject: string | null;
  segmentIds: string[];
  confidence: MatchConfidence;
  source: MatchSource;
  reason: string;
  /** 因每段 6 张上限被挤出的段（留在图库标「已入库未绑定」）。 */
  overflow: string[];
};

const rank: Record<MatchConfidence, number> = { high: 3, medium: 2, low: 1 };

function segmentsForCharacter(episode: Episode, character: string): string[] {
  return episode.segments.filter((segment) => segment.beatIds.some((id) => episode.beats.find((beat) => beat.id === id)?.dialogue?.speaker === character)).map((segment) => segment.id);
}

/**
 * 参考图自动匹配（三级置信度）。返回每张图的归属建议与置信度，绝不静默丢弃：
 * 未命中进「未分配区」（confidence = low），超额段落在 overflow 中显式登记。
 */
export function matchImages(episode: Episode, analyses: Map<string, ImageAnalysis>, roster: EpisodeRoster): MatchOutcome[] {
  const outcomes: MatchOutcome[] = episode.images.map((image) => {
    const analysis = analyses.get(image.id);
    if (!analysis) return { imageId: image.id, subject: null, segmentIds: [], confidence: 'low', source: 'name', reason: '尚无本地图像分析结果', overflow: [] };
    const { kindGuess, subject } = analysis;
    if (kindGuess === 'prop') return { imageId: image.id, subject, segmentIds: [], confidence: 'low', source: 'name', reason: '道具图不自动匹配段落，请人工指定归属', overflow: [] };
    if (!subject) return { imageId: image.id, subject: null, segmentIds: [], confidence: 'low', source: 'name', reason: analysis.subject ? '主体未命中名册' : '未能从文件名判定主体', overflow: [] };

    if (kindGuess === 'character') {
      const hit = roster.characters.includes(subject);
      if (hit) {
        const segmentIds = segmentsForCharacter(episode, subject);
        if (segmentIds.length === 1) return { imageId: image.id, subject, segmentIds, confidence: 'high', source: 'name', reason: `唯一命中角色「${subject}」的出场段`, overflow: [] };
        if (segmentIds.length > 1) return { imageId: image.id, subject, segmentIds, confidence: 'medium', source: 'name', reason: `角色「${subject}」跨 ${segmentIds.length} 段出场，需人工复核`, overflow: [] };
      }
      if (roster.characters.length === 1) {
        const segmentIds = episode.segments.map((segment) => segment.id);
        return { imageId: image.id, subject, segmentIds, confidence: 'medium', source: 'name', reason: `全集仅一个角色，按单角色兜底绑定`, overflow: [] };
      }
      return { imageId: image.id, subject, segmentIds: [], confidence: 'low', source: 'name', reason: `角色「${subject}」不在原稿说话人名册，进入未分配区`, overflow: [] };
    }

    const matched = roster.scenes.filter((scene) => scene.keywords.some((keyword) => keyword === subject || subject.includes(keyword) || keyword.includes(subject)));
    if (matched.length === 1) {
      const segmentIds = episode.segments.filter((segment) => segment.sceneId === matched[0].sceneId).map((segment) => segment.id);
      return { imageId: image.id, subject, segmentIds, confidence: 'high', source: 'name', reason: `唯一命中场景「${matched[0].title}」`, overflow: [] };
    }
    if (matched.length > 1) {
      const ids = new Set(matched.map((scene) => scene.sceneId));
      const segmentIds = episode.segments.filter((segment) => ids.has(segment.sceneId)).map((segment) => segment.id);
      return { imageId: image.id, subject, segmentIds, confidence: 'medium', source: 'name', reason: `命中多个场景（${matched.map((scene) => scene.title).join('、')}），需人工复核`, overflow: [] };
    }
    if (episode.scenes.length === 1) {
      const segmentIds = episode.segments.map((segment) => segment.id);
      return { imageId: image.id, subject, segmentIds, confidence: 'medium', source: 'name', reason: '全集仅一个场景，按单场景兜底绑定', overflow: [] };
    }
    return { imageId: image.id, subject, segmentIds: [], confidence: 'low', source: 'name', reason: `场景名「${subject}」未命中本集场景名册，进入未分配区`, overflow: [] };
  });

  // 每段最多 6 张：按置信度取前 6，溢出的图在该段解除绑定并显式登记。
  for (const segment of episode.segments) {
    const contenders = outcomes.filter((outcome) => outcome.segmentIds.includes(segment.id))
      .sort((a, b) => rank[b.confidence] - rank[a.confidence] || a.imageId.localeCompare(b.imageId));
    contenders.slice(6).forEach((outcome) => {
      outcome.segmentIds = outcome.segmentIds.filter((id) => id !== segment.id);
      outcome.overflow.push(segment.id);
      if (!outcome.segmentIds.length) outcome.reason = `${outcome.reason}；已入库未绑定（超出本段 6 张上限）`;
    });
  }
  return outcomes;
}
