import { builtinStamp, transitionForbiddenWords } from './skill-default';

/**
 * 渲染层的 Skill 加载器与降级（P2 · 施工方案 §3.3）
 *
 * ### 它与 `skill-default.ts` 的分工
 * - `skill-default.ts` = **内置默认包**（判据的 JSON 化内存形态）。永远在，永远可用。
 * - 本文件 = **取包的门**。有桥（桌面版）走主进程读 `resources/skills/`；无桥回落默认包。
 *
 * ### 降级铁律
 * `window.workbench?.skillsLoad` 不存在时（浏览器 `npm run dev`、Vitest、首次加载前的空窗）
 * **一律回落内置默认包**，且 `rules.ts` / `director.ts` 的既有 import 路径与签名一律不变。
 * 因为内置默认包就是「当前硬编码判据的 JSON 化」，降级路径与加载路径**行为等价** ——
 * 单测因此不需要 mock IPC，也不该因为「有没有包」而红。
 *
 * ### 为什么本文件不 import `zod`
 * 主进程侧已经用 zod 做过严格校验（`electron/skills/schema.ts`），跨进程再校验一遍是
 * 双份 schema、两个漂移点。这里只做**形状守卫**（必要字段是不是字符串/数组），
 * 目的是防「桥返回了非预期结构时把 undefined 塞进判据表」，不是重新做一遍契约。
 *
 * ### 加载 ≠ 供源（P2 的分期，P3 已合并）
 * P2 只把**读取与对账**跑通，生效判据仍来自内置默认包（`useDiskRules = false`），
 * 好让「行为零变化」由**结构**保证、而不是靠「包内容恰好没漂移」保证；
 * **P3 起 `useDiskRules = true`**，本地判据改由磁盘包供给，同时退役了
 * `workbench.test.ts` 里那条「主进程与渲染层禁词表一致」的双写护栏断言
 * （改为「两侧读同一份 `rules.json`」的正向断言）。
 */

export type SkillDependency = { id: string; version: string };

/** 清单条目形状：与主进程 `SkillCatalogEntry` 对齐（刻意不共享类型 —— 主进程无法 import `src/`）。 */
export type SkillCatalogEntry = {
  id: string;
  version: string;
  domain?: string;
  entry?: boolean;
  capabilities?: string[];
  dependencies?: SkillDependency[];
  sourceSha256: string;
  path?: string;
};

export type SkillRuleSection = { capability: string } & Record<string, unknown>;

export type SkillPackage = {
  meta: SkillCatalogEntry;
  rules: { skillId: string; version: string; apiVersion: string; sourceSha256: string; sections: SkillRuleSection[] };
  prompt: string;
  dir?: string;
};

/** `{ skillId, version, hash }` —— 施工方案 §8.3 L247「已有项目锁定原版本」的记录元组。 */
export type SkillStamp = { skillId: string; version: string; hash: string };

/**
 * 供源开关（P3 已翻为 `true`）。
 *
 * `false` 时生效判据恒为内置默认包；`true` 时**有包走包、无包回落内置包**。
 * P2 曾刻意留 `false` —— 那时磁盘包刚接上，先让「读取与对账」跑通、把逐字一致的断言按死，
 * 再切换供源，这样每次变更的行为影响都能单独观测。P3 切换后，兜底路径仍保证
 * 「包缺失 / 包被改动 / 未加载完」三种情形都退回与包内容逐字相同的内置表，故两侧等价。
 */
const useDiskRules: boolean = true;

function isCatalogEntry(value: unknown): value is SkillCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0
    && typeof item.version === 'string'
    && typeof item.sourceSha256 === 'string';
}

/** 桥：非 Electron 环境（含 Vitest）下 `window` 可能不存在，故先判 `typeof`。 */
function bridge(): Window['workbench'] {
  return typeof window === 'undefined' ? undefined : window.workbench;
}

/** 是否存在可用桥。UI 可据此显示「桌面版 / 浏览器预览」。 */
export function hasSkillBridge(): boolean {
  const api = bridge();
  return typeof api?.skillsCatalog === 'function' && typeof api?.skillsLoad === 'function';
}

let entries: SkillCatalogEntry[] | null = null;
let entryPackage: SkillPackage | null = null;
let inFlight: Promise<SkillCatalogEntry[]> | null = null;

function sectionFor(pkg: SkillPackage | null, capability: string): Record<string, unknown> | null {
  const section = pkg?.rules?.sections?.find((item) => item?.capability === capability);
  return section ?? null;
}

/**
 * 装载清单（并把入口包读进内存）。**幂等**：同一会话只读盘一次；并发调用共享同一次请求。
 *
 * 失败一律静默回落：包被改动、清单损坏、读盘异常 —— 三种情形都只把结果记为「无包」。
 * 这是刻意的取舍：降级是设计内的正常路径（P2 验收判据「拆掉包目录仍能跑」），
 * 不应在界面上表现为报错；真要排查「我的包为什么没生效」，走 `skillStamp()` 看生效锚
 * 是否仍是 `builtin` 即可定位。
 */
export async function ensureSkills(): Promise<SkillCatalogEntry[]> {
  if (entries) return entries;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const api = bridge();
    if (typeof api?.skillsCatalog !== 'function' || typeof api?.skillsLoad !== 'function') return (entries = []);
    try {
      const listed = await api.skillsCatalog();
      const found = Array.isArray(listed) ? listed.filter(isCatalogEntry) : [];
      const target = found.find((item) => item.entry) ?? found[0];
      if (!target) return (entries = found);
      const pkg = await api.skillsLoad(target.id);
      entryPackage = pkg && typeof pkg === 'object' ? pkg : null;
      return (entries = found);
    } catch {
      entryPackage = null;
      return (entries = []);
    }
  })();
  return inFlight;
}

/**
 * 生效的 ⑭ 衔接禁词表。
 *
 * P3 起**有包取包的 `transition.guard` 节、无包回落内置默认包**（`useDiskRules = true`）。
 * 取包失败、节缺失或节内字段不是非空字符串数组时**逐级回落**到内置默认包 —— 判据表空掉
 * 会让禁词闸门整体失效，那是最不该出现的失败形态。
 */
export function forbiddenWords(): readonly string[] {
  if (!useDiskRules) return transitionForbiddenWords;
  const forbidden = sectionFor(entryPackage, 'transition.guard')?.forbidden;
  if (!Array.isArray(forbidden)) return transitionForbiddenWords;
  const words = forbidden.filter((word): word is string => typeof word === 'string');
  return words.length ? words : transitionForbiddenWords;
}

/** 当前生效的溯源锚：有包列出全部包，无包则给出内置默认包标识（`hash` 为 `builtin`）。 */
export function skillStamp(): SkillStamp[] {
  if (entries?.length) {
    return entries.map((item) => ({ skillId: item.id, version: item.version, hash: item.sourceSha256 }));
  }
  return [{ skillId: builtinStamp.skillId, version: builtinStamp.version, hash: builtinStamp.hash }];
}

/** 入口包（含 `rules` / `prompt`）；无包时为 `null`。供 P5 界面与调试使用。 */
export function entrySkillPackage(): SkillPackage | null {
  return entryPackage;
}

/** 清掉本模块的会话缓存。供单测隔离，以及 P5「装新版本后重取」。 */
export function resetSkillsCache(): void {
  entries = null;
  entryPackage = null;
  inFlight = null;
}
