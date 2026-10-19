import {
  allowedKeys as builtinAllowedKeys,
  systemPrompt as builtinSystemPrompt,
  systemPromptFor,
  transitionForbiddenWords as builtinForbidden,
  transitionPatternFor,
  type AllowedKey,
} from '../prompt.js';
import { loadCatalog, loadSkill, sectionOf } from './manager.js';

/**
 * 主进程侧的**判据取值层**（P3 · 双写退役）
 *
 * 一句话：**有包读包，无包用内置**。与渲染层 `src/platforms/minimax-h3/skills.ts` 完全同构 ——
 * 两侧都优先消费 skill 包里的 `rules.json`，各自的源码常量只作兜底。
 *
 * ### 为什么按 capability 找包，而不是写死包名
 * 判据分散在两类包里：`h3.compile`（生成通道白名单）在入口包，
 * `transition.guard`（⑭ 禁词）在依赖包 `ai-manhua-storyboard-qa`。
 * 写死包名会在「换个包提供同一 capability」时静默失效；按 capability 找则自动跟随包清单，
 * 这也正是 `meta.json` 声明 `capabilities` 的用途。
 *
 * ### 失败即回落，且**不缓存失败**
 * 未装包、包被改动（hash 不符）、`rules.json` 结构变异 —— 任一情形都回落内置表。
 * 回落结果**会**被缓存（同一次会话不必反复读盘），但 `setSkillRoots` 会清掉缓存，
 * 供主进程在知道自己真实落点后重新取值（开发态与打包态的根不同）。
 *
 * 本文件**不 import `electron` 运行时**，可被单测直接导入。
 */

export type MainFeed = {
  /** 生效的 ⑭ 禁词表。 */
  forbidden: readonly string[];
  /** 由 `forbidden` 构造的正则 —— 与词表永远一对一，不会出现「闸门换了、正则还是旧的」。 */
  forbiddenPattern: RegExp;
  /** 生效的生成通道白名单（11 条）。 */
  allowedKeys: readonly AllowedKey[];
  /** 按生效词表拼出的 system prompt。 */
  systemPrompt: string;
  /** 本次取值是否来自 skill 包（`false` = 回落内置兜底）。供测试与诊断使用。 */
  fromPackage: boolean;
};

let roots: string[] = [process.cwd()];
let cached: MainFeed | null = null;

/** 由主进程在 `app.whenReady()` 时用真实落点覆盖；单测不调则用 `cwd`。 */
export function setSkillRoots(next: readonly string[]): void {
  roots = [...next];
  cached = null;
}

/** 当前落点（只读，供诊断与测试）。 */
export function skillRootsInUse(): string[] {
  return [...roots];
}

function builtinFeed(): MainFeed {
  return {
    forbidden: builtinForbidden,
    forbiddenPattern: transitionPatternFor(builtinForbidden),
    allowedKeys: builtinAllowedKeys,
    systemPrompt: builtinSystemPrompt,
    fromPackage: false,
  };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const words = value.filter((word): word is string => typeof word === 'string' && Boolean(word.trim()));
  return words.length ? words : null;
}

/**
 * 白名单取值：只要有一个键不在字面量类型内就**整份作废**（回落内置），不做「静默剔除多余键」。
 * 静默剔除会把「包写错了字段名」伪装成正常降级 —— 白名单悄悄少一条，输出就少一个字段。
 */
function allowedKeyList(value: unknown): AllowedKey[] | null {
  const keys = stringList(value);
  if (!keys) return null;
  const known = new Set<string>(builtinAllowedKeys);
  return keys.every((key) => known.has(key)) ? (keys as AllowedKey[]) : null;
}

/**
 * 取当前生效判据。第一次调用读盘，之后走缓存。
 *
 * 「部分命中」也回落：只有 `transition.guard` 拿到而 `h3.compile` 没拿到时，
 * 整份退回内置 —— 混搭两份来源最容易产出「禁词是新的、白名单是旧的」这种难查的不一致。
 */
export function mainFeed(): MainFeed {
  if (cached) return cached;
  cached = builtinFeed();
  try {
    const entries = loadCatalog(roots);
    if (!entries.length) return cached;

    const guardEntry = entries.find((entry) => entry.capabilities?.includes('transition.guard'));
    const compileEntry = entries.find((entry) => entry.capabilities?.includes('h3.compile'));
    if (!guardEntry || !compileEntry) return cached;

    const forbidden = stringList(sectionOf(loadSkill(guardEntry.id, roots), 'transition.guard')?.forbidden);
    const allowed = allowedKeyList(sectionOf(loadSkill(compileEntry.id, roots), 'h3.compile')?.allowedKeys);
    if (!forbidden || !allowed) return cached;

    cached = {
      forbidden,
      forbiddenPattern: transitionPatternFor(forbidden),
      allowedKeys: allowed,
      systemPrompt: systemPromptFor(forbidden),
      fromPackage: true,
    };
  } catch {
    // 未装包 / 包被改动 / 读盘失败 —— 回落是设计内的正常路径，不抛给调用方。
    cached = builtinFeed();
  }
  return cached;
}

/** 清缓存（测试隔离与「装新版本后重取」用）。 */
export function resetMainFeed(): void {
  cached = null;
}
