import type { Episode, Project, Shot } from '../../core/model';
import { speakerTrusted } from '../../core/parser';
import {
  compositionContradictsStaging, projectCast, scaleSubjectConflict, shotSpeakers, sidesIn, sourceFieldsForShot,
  transitionContextOf, transitionPremiseUnmet, type ShotEvidence,
} from './director';
import type { IssueCode } from './rules';

/**
 * 「正文 × 剧本」一致性审计（**通用闸门**）。
 *
 * 设计原则：**与具体剧本无关**。这里不含任何作品专属词表、集号、人名或阈值调参 ——
 * 判据全部来自原稿本身（人物名册、场次、节拍、台词）与生成端的同源函数。
 * 因此换任何一部剧本都不需要单独升级：导入 → 生成 → 审计自动执行。
 *
 * 历史教训（这些检查对应的真实缺陷，均已在真稿上复现并修复）：
 * - 名册被叙述片段污染 → ⑨ 写出「冯京一」「慢慢」这类不存在的人物（`BLOCKING_UNKNOWN_SUBJECT`）
 * - 侧位按本镜前两名相对取左右 → 同场次同一人反复换边，越轴穿帮（`AXIS_JUMP`）
 * - 衔接按序号盲选 → 空镜写「视线引导」、无台词镜写 L-Cut（`TRANSITION_PREMISE`）
 * - 情绪镜固定面部特写却入画两人（`SCALE_SUBJECT_CONFLICT`）
 * - 景别只按节拍类型给档、不看入画人数 → 空镜（内心OS 覆盖镜 / 纯环境镜）也写「过肩中景」「中近景」（`SCALE_SUBJECT_CONFLICT`）
 * - 代词主语被行首镜头标记挡住（`【接·视线】他抬头…`）→ 隐性主体丢失
 *
 * 判据一律**保守**：只识别生成端 `stagingFor` 产出的三种站位写法与规则表内的衔接文案，
 * 人工自创写法识别不到就跳过，宁可漏报也不误报。
 */

export type ContentIssue = { code: IssueCode; message: string; segmentId?: string; shotId?: string };

type Walked = { shot: Shot; segmentId: string; sceneId: string };

/**
 * 按集顺序展开全部镜头，并逐镜算出证据（走生成端同一套主体判定）。
 * 顺序与 `episode.segments` / `segment.shots` 完全一致，供跨镜检查使用。
 */
function walkShots(project: Project, episode: Episode): { items: Walked[]; evidence: Map<string, ShotEvidence> } {
  const items: Walked[] = [];
  for (const segment of episode.segments) {
    for (const shot of segment.shots) items.push({ shot, segmentId: segment.id, sceneId: segment.sceneId });
  }
  const evidence = new Map<string, ShotEvidence>();
  for (const item of items) if (!evidence.has(item.shot.id)) evidence.set(item.shot.id, sourceFieldsForShot(project, episode, item.shot));
  return { items, evidence };
}

/**
 * 一致性审计正本：返回本集全部「正文 × 剧本」矛盾项。
 * 只读、幂等、无副作用；同一工程同一集多次调用结果完全一致。
 */
export function auditEpisodeContent(project: Project, episode: Episode): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const cast = projectCast(project);
  const castSet = new Set(cast);
  const { items, evidence } = walkShots(project, episode);
  /** 越轴台账：`场次|人物` → 首次确定的侧位。 */
  const sideLedger = new Map<string, string>();

  items.forEach(({ shot, segmentId, sceneId }, index) => {
    const subjectNames = evidence.get(shot.id)?.subjects ?? [];

    // ① ⑫ 说话人必须可信（解析层已保证；人工或 AI 改写后由此拦下）。
    for (const item of shot.dialogue) {
      if ((item.kind ?? 'dialogue') !== 'dialogue') continue;
      if (!speakerTrusted(item.speaker, cast)) issues.push({ code: 'SPEAKER_UNTRUSTED', message: `⑫ 台词说话人「${item.speaker}」无法在原稿中确证，疑似叙述行被当成台词`, segmentId, shotId: shot.id });
    }

    // ② ⑨/④ 只允许写真实人物：名册成员或本镜说话人，其余一律视为臆造主体。
    const allowed = new Set([...castSet, ...shotSpeakers(episode, shot)]);
    const sides = sidesIn(shot.blocking);
    for (const [name] of sides) {
      if (name && !allowed.has(name)) issues.push({ code: 'BLOCKING_UNKNOWN_SUBJECT', message: `⑨ 站位写出原稿中不存在的主体「${name}」，疑似叙述片段被当成人物`, segmentId, shotId: shot.id });
    }

    // ③ 越轴：同场次内同一人物必须始终在同一侧，否则穿帮。
    for (const [name, side] of sides) {
      const key = `${sceneId}|${name}`;
      const seen = sideLedger.get(key);
      if (!seen) sideLedger.set(key, side);
      else if (seen !== side) issues.push({ code: 'AXIS_JUMP', message: `越轴：${name} 在本场次内由画面${seen}跳到画面${side}，同一场次必须锁定同一侧`, segmentId, shotId: shot.id });
    }

    // ④ ⑭ 衔接前提：不得使用「本镜无台词却写 L-Cut」这类前提不成立的衔接。
    const nextItem = items[index + 1];
    const nextShot = nextItem?.shot;
    const context = transitionContextOf(shot, evidence.get(shot.id)!, nextShot ? evidence.get(nextShot.id) : undefined, nextShot);
    if (transitionPremiseUnmet(shot.transition, context)) {
      issues.push({ code: 'TRANSITION_PREMISE', message: `⑭ 衔接「${shot.transition.slice(0, 12)}…」的前提在本镜/下一镜不成立，属张冠李戴`, segmentId, shotId: shot.id });
    }

    // ⑤ ③ 景别与入画人数：人脸特写收不下两个主体，人物档景别也套不住空镜。判据与生成端同源。
    const scaleConflict = scaleSubjectConflict(shot.scale, subjectNames.length);
    if (scaleConflict) {
      const who = subjectNames.length ? `（${subjectNames.join('、')}）` : '';
      issues.push({ code: 'SCALE_SUBJECT_CONFLICT', message: `③ 景别×入画人数冲突：${scaleConflict}，本镜入画 ${subjectNames.length} 人${who}`, segmentId, shotId: shot.id });
    }

    // ⑥ ④ 构图与 ⑨ 站位不得把主体写到相反一侧。
    if (compositionContradictsStaging(shot.composition, shot.blocking)) {
      issues.push({ code: 'STAGING_COMPOSITION_CONFLICT', message: '④ 构图与 ⑨ 站位把主体写到了相反一侧', segmentId, shotId: shot.id });
    }
  });

  return issues;
}
