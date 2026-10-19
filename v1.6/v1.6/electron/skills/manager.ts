import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  formatIssues,
  skillCatalogEntrySchema,
  skillCatalogSchema,
  skillMetaSchema,
  skillRulesSchema,
  type SkillCatalogEntry,
  type SkillDependency,
  type SkillMeta,
  type SkillRules,
} from './schema.js';

/**
 * SkillManager（P2 · 加载器接线）
 *
 * 职责单一：**把磁盘上的 skill 包读成内存对象，并在装载前证明它没被动过。**
 * 它不做任何判据语义解释 —— 那是执行层（渲染层 `rules.ts` / 主进程 `script.ts`）的事。
 *
 * ### 为什么不 import `electron`
 * 与 `credentials.ts` 同一条纪律：落点由**调用方**以 `bases` 传入（开发态 `app.getAppPath()`、
 * 打包态 `process.resourcesPath`、`cwd` 兜底），本模块只做「在给定根里按序找包」。
 * 好处是单元测试能直接 import 并指向临时目录，不需要起 Electron。
 *
 * ### 完整性校验为什么用原始字节
 * 实测 5 个包的 `SKILL.md` 原始字节 SHA-256 与 `meta.json` 登记的 `sourceSha256` **全部一致**，
 * 因此不存在「必须做换行规范化才能匹配」的情况。反过来，**做了规范化会出问题**：
 * `ai-manhua-storyboard-qa` 与 `ai-manhua-screenplay-comprehensive` 的上游正本是 CRLF，
 * 规范化后哈希变为另一串，会让「改了一位」与「只是换行风格不同」两种情形无法区分。
 * 故此处只认原始字节；换行稳定性由仓库根的 `.gitattributes` 锁死（`resources/skills/** -text`）。
 *
 * ### 缓存的失效判据
 * 以 `meta.json` / `catalog.json` 的 `mtimeMs` 为准（施工方案 §3.1）。不引入文件监听：
 * 包在运行期被替换是「装新版本」这一显式动作，P5 的界面会重取；本层只需不自欺。
 *
 * 本文件不引用 `electron` 运行时，可被单元测试直接导入。
 */

/** 相对各 base 的候选子路径，按序回退。开发态命中第一条，打包态（extraResources → `skills/`）命中第二条。 */
const skillRootSuffixes = ['resources/skills', 'skills'] as const;

/** 扫盘生成目录清单时的最大递归深度：`<root>/<domain>/deps/<id>/<version>` 恰为 4 层，留 2 层余量。 */
const scanMaxDepth = 6;

/** 一个已装载的包：清单 + 判据 + AI 段文本 + 落点（落点只用于报错定位与溯源，不进业务数据）。 */
export type SkillPackage = {
  meta: SkillMeta;
  rules: SkillRules;
  prompt: string;
  dir: string;
};

/** 完整性校验结果。`ok === false` 时 `expected` / `actual` 便于界面直接展示「哪个包、哪串对不上」。 */
export type SkillIntegrity = {
  ok: boolean;
  skillId: string;
  expected: string;
  actual: string;
};

/**
 * 候选根目录（**按序回退**）：对每个 base 依次拼 `resources/skills`、`skills`。
 * 不去重 base，只去重结果，避免同一根被拼两次。
 */
export function skillRoots(bases: readonly string[] = [process.cwd()]): string[] {
  const roots: string[] = [];
  for (const base of bases) {
    for (const suffix of skillRootSuffixes) {
      const root = join(base, ...suffix.split('/'));
      if (!roots.includes(root)) roots.push(root);
    }
  }
  return roots;
}

/** 路径比对前统一分隔符：`catalog.json` 里的 `path` 一律用 `/`（跨平台可移植），文件系统调用要转回本机风格。 */
function toNative(relativePath: string): string[] {
  return relativePath.split('/').filter(Boolean);
}

/** 落点写回 `catalog.json` 时统一用 `/`。 */
function toPortable(absolutePath: string): string {
  return absolutePath.split(sep).join('/');
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** mtime 失效判据；文件不存在记 `-1`（与「存在但 mtime 为 0」区分开）。 */
function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
}

/**
 * 选定生效的根：**优先含 `catalog.json` 的那个**（清单是正本）；
 * 若无任何根带清单，返回第一个**存在**的根，交由 `loadCatalog` 扫盘生成清单。
 * 都不存在则 `null` —— 这就是「拆掉包目录」的情形，调用方据此回落内置默认包。
 */
export function findSkillRoot(roots: readonly string[]): string | null {
  for (const root of roots) if (isFile(join(root, 'catalog.json'))) return root;
  for (const root of roots) if (isDir(root)) return root;
  return null;
}

function readJson(path: string): unknown {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`无法读取 ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} 不是合法 JSON`);
  }
}

/** 读一个包的 `meta.json` 并校验（**不校验 hash** —— hash 是对 `SKILL.md` 的，见 `verifySkill`）。 */
export function readMeta(dir: string): SkillMeta {
  const parsed = skillMetaSchema.safeParse(readJson(join(dir, 'meta.json')));
  if (!parsed.success) throw new Error(`${join(dir, 'meta.json')} 校验失败：${formatIssues(parsed.error)}`);
  return parsed.data;
}

/** 读一个包的 `rules.json` 并校验。 */
export function readRules(dir: string): SkillRules {
  const parsed = skillRulesSchema.safeParse(readJson(join(dir, 'rules.json')));
  if (!parsed.success) throw new Error(`${join(dir, 'rules.json')} 校验失败：${formatIssues(parsed.error)}`);
  return parsed.data;
}

/**
 * 索引条目的**唯一构造器**：`catalog.json` 与扫盘走同一个出口。
 *
 * 之所以要收这一个口：两个来源若各自拼对象，就会出现「带清单时条目含 A 字段、扫盘时含 B 字段」
 * 的隐性分叉 —— 上层只在某一条路径上正确，而这条路径平时跑不到。
 *
 * 参数类型**显式写出**而不是 `Omit<SkillCatalogEntry, …>`：`SkillCatalogEntry` 出自
 * `.loose()` 的 zod schema，带 `[key: string]: unknown` 索引签名，`Omit` 之后会把 `id`、`version`
 * 这些具体键一起退化成 `unknown`（TS 报「unknown 不能赋给 string」）。
 */
type IndexFields = {
  id: string;
  version: string;
  domain?: string;
  entry?: boolean;
  dependencies: SkillDependency[];
  sourceSha256: string;
  capabilities: string[];
};

function indexEntryOf(meta: IndexFields, path: string): SkillCatalogEntry {
  return {
    id: meta.id,
    version: meta.version,
    domain: meta.domain,
    entry: meta.entry ?? false,
    dependencies: meta.dependencies,
    sourceSha256: meta.sourceSha256,
    capabilities: meta.capabilities,
    path,
  };
}

/**
 * 扫盘生成目录清单（`catalog.json` 缺失时的兜底）。
 *
 * 判据极简：**一个目录里同时有 `meta.json` 就算一个包**。depth 上限防止误指到大目录时无限递归。
 * 产出的条目与 `catalog.json` 逐字段同构（共用 `indexEntryOf`），因此上层无需分辨来源。
 */
export function scanCatalog(root: string): SkillCatalogEntry[] {
  const found: SkillCatalogEntry[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > scanMaxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === 'meta.json')) {
      found.push(indexEntryOf(readMeta(dir), toPortable(relative(root, dir))));
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** 目录清单缓存。`stamp` 取 `catalog.json` 的 mtime；扫盘模式取根目录自身的 mtime。 */
let catalogCache: { root: string; stamp: number; entries: SkillCatalogEntry[] } | null = null;

/**
 * 读目录清单。**找不到任何包目录时返回 `[]` 而不抛错** —— 「拆掉包目录仍能跑」的验收判据
 * 要求这条路径必须干净地降级，而不是把异常抛到渲染层。
 *
 * 反过来说，**只要找到了包目录，校验就是严格的**：清单里任何一条不合格都汇总报错。
 * 一个损坏的包不该被静默跳过 —— 那会退化成「装没装上没人知道」，正是本项目最要避免的失败形态。
 */
export function loadCatalog(bases: readonly string[] = [process.cwd()]): SkillCatalogEntry[] {
  const roots = skillRoots(bases);
  const root = findSkillRoot(roots);
  if (!root) {
    catalogCache = null;
    return [];
  }
  const stamp = mtimeOf(join(root, 'catalog.json'));
  if (catalogCache && catalogCache.root === root && catalogCache.stamp === stamp) return catalogCache.entries;

  const manifestPath = join(root, 'catalog.json');
  let entries: SkillCatalogEntry[];
  if (isFile(manifestPath)) {
    const head = skillCatalogSchema.safeParse(readJson(manifestPath));
    if (!head.success) throw new Error(`${manifestPath} 校验失败：${formatIssues(head.error)}`);
    const problems: string[] = [];
    entries = [];
    for (const raw of head.data.packages) {
      const parsed = skillCatalogEntrySchema.safeParse(raw);
      if (parsed.success) entries.push(indexEntryOf(parsed.data, parsed.data.path));
      else problems.push(`「${(raw as { id?: unknown })?.id ?? '未知包'}」${formatIssues(parsed.error)}`);
    }
    if (problems.length) throw new Error(`${manifestPath} 中 ${problems.length} 个条目不合格：${problems.join('；')}`);
  } else {
    entries = scanCatalog(root);
  }

  catalogCache = { root, stamp: mtimeOf(join(root, 'catalog.json')), entries };
  return entries;
}

/** 装载缓存：以 `meta.json` 的 mtime 做失效判据。 */
const packageCache = new Map<string, { stamp: number; pkg: SkillPackage }>();

/**
 * 定位一个包的目录。找不到返回 `null`（调用方决定是降级还是报错）。
 *
 * ⚠️ 参数是 **bases**（应用根 / 打包资源根）而不是展开后的 roots。曾在此处误传 roots，
 * 导致 `loadCatalog` 把 `<root>/resources/skills` 再拼一层 `resources/skills`，根找不到 →
 * 顺带把刚才那份正确的清单缓存清空。**这个 bug 的症状很隐蔽**：`loadCatalog` 单独调用一切正常，
 * 只有经 `loadSkill` / `verifySkill` 间接触发时才表现为「包明明在盘上却报未找到」。
 */
function locateDir(id: string, bases: readonly string[]): { root: string; dir: string } | null {
  const root = findSkillRoot(skillRoots(bases));
  if (!root) return null;
  const entry = loadCatalog(bases).find((item) => item.id === id);
  if (!entry) return null;
  return { root, dir: join(root, ...toNative(entry.path)) };
}

/** 计算文件内容的 SHA-256（原始字节，不做换行规范化 —— 理由见文件头）。 */
function sha256OfFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * 完整性校验：`meta.sourceSha256` 应等于 `SKILL.md` 的原始字节哈希。
 *
 * **不抛错**（与 `loadSkill` 相反）—— 它同时是「装新版本前先验签」这一动作的接口（P5 界面会直接展示
 * `expected` / `actual`），报错不如给出一对可比对的串。
 */
export function verifySkill(id: string, bases: readonly string[] = [process.cwd()]): SkillIntegrity {
  const located = locateDir(id, bases);
  if (!located) return { ok: false, skillId: id, expected: '', actual: '' };
  const meta = readMeta(located.dir);
  const skillMd = join(located.dir, 'SKILL.md');
  const actual = isFile(skillMd) ? sha256OfFile(skillMd) : '';
  return { ok: actual !== '' && actual === meta.sourceSha256, skillId: id, expected: meta.sourceSha256, actual };
}

/**
 * 装载一个包：清单 + 判据 + AI 段文本，**装载前先证明 `SKILL.md` 未被改动**。
 *
 * 校验失败即抛错（P2 验收判据「包内 hash 改一位即报错」）。这条纪律的取舍是刻意的：
 * 一个被改过的包意味着「判据正本与它的溯源锚脱节」，此时继续装载等于让无锚内容参与生成。
 * 渲染层捕获后回落内置默认包，界面照常可用 —— **报错不等于不可用**。
 */
export function loadSkill(id: string, bases: readonly string[] = [process.cwd()]): SkillPackage {
  const roots = skillRoots(bases);
  const located = locateDir(id, bases);
  if (!located) {
    throw new Error(`未找到 skill 包「${id}」；已查找：${roots.join(' / ')}`);
  }
  const cached = packageCache.get(located.dir);
  const stamp = mtimeOf(join(located.dir, 'meta.json'));
  if (cached && cached.stamp === stamp) return cached.pkg;

  const integrity = verifySkill(id, bases);
  if (!integrity.ok) {
    throw new Error(
      `skill 包「${id}」完整性校验失败：SKILL.md 实际 SHA-256 ${integrity.actual || '(缺失)'}，`
      + `与 meta.json 登记的 ${integrity.expected || '(缺失)'} 不一致 —— 拒绝装载，请重跑 node scripts/build-skill-packages.mjs`,
    );
  }

  const meta = readMeta(located.dir);
  const rules = readRules(located.dir);
  const promptPath = join(located.dir, 'prompt.md');
  const prompt = isFile(promptPath) ? readFileSync(promptPath, 'utf8') : '';
  const pkg: SkillPackage = { meta, rules, prompt, dir: located.dir };
  packageCache.set(located.dir, { stamp, pkg });
  return pkg;
}

/** 取一个包的某个 capability 节；无该节返回 `null`（调用方据此判断「本包对这项没有判据供给」）。 */
export function sectionOf(pkg: SkillPackage, capability: string): Record<string, unknown> | null {
  const found = pkg.rules.sections.find((section) => section.capability === capability);
  return found ? (found as Record<string, unknown>) : null;
}

/**
 * 按 manifest 的 `dependencies` 解析出装载顺序：**依赖在前、入口在后**。
 *
 * 首版只有一个入口，不存在版本冲突求解 —— 故此函数不实现 semver 区间匹配，
 * 只做「列出来、排好序、缺了就报」。真要处理冲突时（P5 多包并存）再补。
 */
export function resolveOrder(entries: readonly SkillCatalogEntry[]): SkillCatalogEntry[] {
  const byId = new Map(entries.map((item) => [item.id, item]));
  const ordered: SkillCatalogEntry[] = [];
  const visiting = new Set<string>();
  const visit = (entry: SkillCatalogEntry) => {
    if (ordered.includes(entry) || visiting.has(entry.id)) return;
    visiting.add(entry.id);
    for (const dependency of entry.dependencies) {
      const target = byId.get(dependency.id);
      if (target) visit(target);
    }
    visiting.delete(entry.id);
    ordered.push(entry);
  };
  for (const entry of entries) visit(entry);
  return ordered;
}

/** 供测试与 P5「重取清单」使用：清掉两层缓存。 */
export function clearSkillCache(): void {
  catalogCache = null;
  packageCache.clear();
}
