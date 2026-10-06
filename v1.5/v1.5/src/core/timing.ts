import type { Shot } from './model';
import { effectiveLength } from './parser';

/**
 * 段内时长分配（**正本 · 单一来源**）。
 *
 * 产品方案硬性不变量：每个 P 段 = 15 秒，**段内各镜时长之和 = 15 秒**，
 * 单镜 ≤ 12 秒且 > 0 秒。分镜规划（`planner`）与规则导演生成（`director`）
 * 共用这里的同一把尺子，任何一处都不得再自行给镜头写死时长。
 *
 * 权重取「该镜台词的有效字数」为主依据；无台词的镜头按节拍数拿保底份额 ——
 * 武戏因此自然退化为「按节拍数分配」，不需要第二张动作词表。
 * 时长由本模块全权决定，界面只读展示，用户不手改（改的是内容，不是秒数）。
 */

/** 段时长（秒）：每个 P 段固定 15 秒。 */
export const segmentDuration = 15;
/** 单镜时长上限（秒）：段内镜头不得超过 12 秒，对应 `SHOT_DURATION_MAX` 闸门。 */
export const shotDurationMax = 12;
/** 单镜时长下限（秒）：分配不得产出 0 秒镜头。 */
export const shotDurationMin = 1;
/** 无台词镜头的保底权重：每拍一份基础份额，保证空镜也拿到可拍时长。 */
const baseBeatWeight = 3;

function clampTo(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 按权重把 total 秒切成整数份：每份夹在 [min, max] 内，且合计恰为 total。 */
function splitByWeight(weights: number[], total: number, min: number, max: number): number[] {
  const safe = weights.map((weight) => (weight > 0 ? weight : 1));
  const sum = safe.reduce((acc, weight) => acc + weight, 0);
  const ideals = safe.map((weight) => (total * weight) / sum);
  const shares = ideals.map((ideal) => clampTo(Math.floor(ideal), min, max));
  // 小数部分降序：补足余数时优先照顾「本该拿到更多」的镜头；同分按原序，保证确定性。
  const order = ideals
    .map((ideal, index) => ({ index, fraction: ideal - Math.floor(ideal) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  let gap = total - shares.reduce((acc, value) => acc + value, 0);
  while (gap > 0) {
    let moved = false;
    for (const { index } of order) {
      if (gap <= 0) break;
      if (shares[index] < max) { shares[index] += 1; gap -= 1; moved = true; }
    }
    if (!moved) break;
  }
  while (gap < 0) {
    let moved = false;
    for (let index = order.length - 1; index >= 0; index -= 1) {
      if (gap >= 0) break;
      const target = order[index].index;
      if (shares[target] > min) { shares[target] -= 1; gap += 1; moved = true; }
    }
    if (!moved) break;
  }
  return shares;
}

/**
 * 把本段的 15 秒分配给段内各镜。
 *
 * 约束：各镜之和 === `segmentDuration`；每镜 ∈ [`shotDurationMin`, `shotDurationMax`]。
 * 段内只有一镜时独占整段 —— 此时上限不适用（`validator` 对单镜段同样豁免），
 * 否则「各镜之和 = 段长」这条不变量无法成立。
 */
export function allocateShotDurations(shots: Shot[]): number[] {
  if (!shots.length) return [];
  if (shots.length === 1) return [segmentDuration];
  const weights = shots.map((shot) => {
    const spoken = effectiveLength(shot.dialogue.map((item) => item.text).join(''));
    const beats = Math.max(1, shot.beatIds.length);
    return spoken + beats * baseBeatWeight;
  });
  return splitByWeight(weights, segmentDuration, shotDurationMin, shotDurationMax);
}
