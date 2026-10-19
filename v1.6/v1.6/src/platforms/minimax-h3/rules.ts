import { ignorableIssueCategories, issueCategoryNames, issuePolicy, transitionForbiddenWords } from './skill-default';
import { forbiddenWords } from './skills';

/**
 * 闸门规则出口（叶子模块）：判据本体已收拢到 `skill-default.ts`（P1 · 判据 JSON 化），
 * 本文件只做**再导出** —— 既有 import 路径与签名一律不变，因此调用方一行不改。
 *
 * 之所以独立成模块：`director` 需要禁词表做衔接兜底，`validator` 需要问题分级表，
 * `audit` 需要问题编号 —— 三者若互相 import 会形成环，故把「规则」下沉到最底层。
 * 依赖纪律：本模块只可依赖 `src/core/` 的纯计算模块与 `./skills`（取值层），**不得**反向 import
 * 任何业务模块（`director` / `validator` / `audit` / `gate`）。
 *
 * ### P3 · 双写退役：内置值 与 生效值 的分工
 * - `transitionForbiddenWords` / `transitionForbiddenPattern` = **内置兜底**（`skill-default.ts` 的形态）。
 *   保留它们是因为：内置包是「无包环境」的唯一来源，且既有调用点与断言都按它写。
 * - `activeForbiddenWords()` / `activeForbiddenPattern()` = **运行时生效值**（有包走包、无包即内置）。
 *   业务代码（`validator` / `director`）一律用这一对 —— 这样「闸门用哪份词表」只有一处答案。
 * - 两者当前内容完全相同（`skill-packages.test.ts` 有逐字一致断言按着），所以本阶段是**零行为变化**；
 *   将来包被更新（P5 装新版本）时，'生效值' 会变、内置兜底不变，差异正好是预期的那部分。
 */

export { ignorableIssueCategories, issueCategoryNames, issuePolicy, transitionForbiddenWords };

/** 由词表构造：正则与数组永不脱节（全部为中文词，无正则元字符）。此处为**内置兜底**的正则。 */
export const transitionForbiddenPattern = new RegExp(transitionForbiddenWords.join('|'), 'u');

/**
 * 生效禁词表：有 skill 包取包、无包回落内置默认包（见 `./skills`）。
 *
 * 每一次调用都直通取值层，**不做本地缓存** —— 取值层自己维护「已加载 / 未加载」状态，
 * 这里再缓一层会在 P5「装新版本后重取」时留下陈旧值。
 */
export function activeForbiddenWords(): readonly string[] {
  return forbiddenWords();
}

/** 生效禁词正则。按词表**引用**缓存：词表没换就不重编译正则（`validate` 会逐镜调用它）。 */
let patternWords: readonly string[] | null = null;
let patternValue: RegExp | null = null;

export function activeForbiddenPattern(): RegExp {
  const words = forbiddenWords();
  if (patternWords !== words || !patternValue) {
    patternWords = words;
    patternValue = new RegExp(words.join('|'), 'u');
  }
  return patternValue;
}

/**
 * 时长常量与段内分配的唯一正本在 `src/core/timing.ts`（与 `planner` 同层，
 * 使分镜规划与生成共用同一把尺子）；此处只做转发，保持既有 import 路径不变。
 */
export { segmentDuration, shotDurationMax, shotDurationMin } from '../../core/timing';

export type IssueCode = keyof typeof issuePolicy;
