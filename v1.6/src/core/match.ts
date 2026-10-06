import type { Episode, ImageAnalysis, MatchConfidence, MatchSource, ReferenceImage } from './model';
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
 * 参考图自动匹配（三级置信度）：**为某一集**在**全项目资产库**里选配资产。
 *
 * 资产库是项目级的（导入一次、全本共用），匹配则逐集进行 —— 判据是该集的名册（说话人 / 场景名）
 * 与该集的段落结构，因此「同一张主角图在 A 集是唯一命中、在 B 集是跨段需复核」这类差异
 * 天然存在，结论由调用方记到 `episode.imageMatches`，不写回资产本身。
 *
 * **图类裁决以用户导入时选择的分类为准**（`image.kind`），文件名猜测出的 `analysis.kindGuess`
 * 只作界面提示、不参与裁决。理由：用户把图放进「人物 / 场景」是有意为之，
 * 是比文件名更强的证据；而 `classifyKind` 实际只能看文件名（`analyzeWithStats` 不传宽高，
 * 其画幅兜底分支不可达）——真稿实测「林夏.png」猜不出图类（原口径判 prop）→ 撞上
 * 「道具图不自动匹配段落」，整集 ① 人物描述为空，仅改名「林夏_人物.png」即恢复绑定。
 * 2026-10-06「道具」图类退役后那条分支不复存在，该缺陷的成因亦随之消失。
 *
 * 返回每张图的归属建议与置信度，绝不静默丢弃：
 * 未命中进「未分配区」（confidence = low），超额段落在 overflow 中显式登记。
 */
export function matchImages(assets: ReferenceImage[], episode: Episode, analyses: Map<string, ImageAnalysis>, roster: EpisodeRoster): MatchOutcome[] {
  const outcomes: MatchOutcome[] = assets.map((image) => {
    const analysis = analyses.get(image.id);
    if (!analysis) return { imageId: image.id, subject: null, segmentIds: [], confidence: 'low', source: 'name', reason: '尚无本地图像分析结果', overflow: [] };
    const { subject } = analysis;
    /** 用户选择的分类 = 权威图类；`kindGuess` 仅供界面提示。 */
    const kind = image.kind;
    if (!subject) return { imageId: image.id, subject: null, segmentIds: [], confidence: 'low', source: 'name', reason: analysis.subject ? '主体未命中名册' : '未能从文件名判定主体', overflow: [] };

    if (kind === 'character') {
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
