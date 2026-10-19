import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  clearSkillCache,
  findSkillRoot,
  loadCatalog,
  loadSkill,
  readMeta,
  resolveOrder,
  scanCatalog,
  sectionOf,
  skillRoots,
  verifySkill,
} from '../../electron/skills/manager';
import { formatIssues, skillCatalogSchema, skillMetaSchema } from '../../electron/skills/schema';
import {
  builtinStamp,
  h3CompileAllowedKeys,
  ignorableIssueCategories,
  issueCategoryNames,
  issuePolicy,
  segmentTailTransition,
  skeletonFields,
  skeletonGeneratedKeys,
  skeletonProtectedKeys,
  transitionForbiddenWords,
  transitionPositivePool,
  transitionTemplates,
} from '../../src/platforms/minimax-h3/skill-default';
import { ensureSkills, entrySkillPackage, forbiddenWords, hasSkillBridge, resetSkillsCache, skillStamp } from '../../src/platforms/minimax-h3/skills';

/**
 * P2 · 加载器接线的验收测试
 *
 * 施工方案 §7 给 P2 定了两条硬判据，本文件逐条落地：
 * 1. **拆掉包目录仍能跑（降级）** —— 清单回空、装载抛可读错误、渲染层回落内置默认包。
 * 2. **包内 hash 改一位即报错** —— 篡改副本的 `SKILL.md` 后 `verifySkill` 为假、`loadSkill` 抛错。
 *
 * 另加一条 P2 独有的防漂移断言：**盘上 `rules.json` 与 `src/platforms/minimax-h3/skill-default.ts`
 * 逐字一致**。这是「P2 行为零变化」的**依据** —— 生效判据虽仍取自内置默认包（P3 才切换供源），
 * 但两者一旦漂移，P3 翻开关的那一刻行为就会突变，而那时已经离这次改动很远了。
 * 把它按在这里，漂移当场就会被抓住。
 *
 * ### 为什么测试里一个删除动作都没有
 * 宿主（WorkBuddy CLI）对 `node:fs` 挂了 safe-delete 垫片，**任何**删除（递归 `rmSync`、
 * 逐项 `unlinkSync` / `rmdirSync`）都会被改写成「移入回收站」流程，在临时目录上失败或慢到超时 ——
 * 实测 22 个用例全绿、却因 `afterAll` 报 Failed Suite（先是 trash 报错，后是 10 秒 hook 超时）。
 *
 * 因此本文件改用**固定 fixture、只覆盖写、零删除**：
 * - fixture 落在 `<仓库>/.workbuddy/temp/skill-fixtures/`（已被 `.gitignore` 忽略，不散落到正式目录）；
 * - 每次 `beforeAll` 把正确内容重写一遍（幂等），用例只做「再改一位」这类**写**动作；
 * - 需要「目录不存在」的场景直接用**不存在的路径**表达，不必先建再删。
 *
 * 落盘负例刻意用**手工最小包**（4 个小文件）而不是复制真包：真包的锚由正例直接对
 * `resources/skills/` 校验即可，负例只需要证明「改动即被拦」，无需背 297K 的复制成本。
 */

const repo = process.cwd();
const skillsRoot = join(repo, 'resources', 'skills');

/** 一个**不存在**的目录：用来表达「拆掉包目录」而不必真的先建后删。 */
const missingBase = join(repo, '.workbuddy', 'temp', 'skill-fixtures', '__no_such__');
const fixtureBase = join(repo, '.workbuddy', 'temp', 'skill-fixtures');
/** 手工最小包所在的 base；其 `resources/skills/...` 结构由 `writeFixture` 铺好。 */
const tamperBase = join(fixtureBase, 'tamper');
const tamperDir = join(tamperBase, 'resources', 'skills', 'minimax-h3', 'minimax-h3-video-prompt', '2.1.0');
/** 只有一份 `catalog.json` 的 base，用于协议版本闸门与条目闸门。 */
const badCatalogBase = join(fixtureBase, 'bad-catalog');
const badCatalogPath = join(badCatalogBase, 'resources', 'skills', 'catalog.json');

const packageIds = [
  'ai-manhua-director-thinking',
  'ai-manhua-emotion-clip',
  'ai-manhua-screenplay-comprehensive',
  'ai-manhua-storyboard-qa',
  'minimax-h3-video-prompt',
];

const sha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const skillMdText = '---\nname: fake-skill\n---\n\n# 假包正本\n\n用于验证「改一位即报错」。\n';

/** 铺好最小包 fixture（幂等：每次都把正确内容重写一遍）。 */
function writeFixture(): void {
  mkdirSync(tamperDir, { recursive: true });
  writeFileSync(join(tamperDir, 'SKILL.md'), skillMdText, 'utf8');
  writeFileSync(join(tamperDir, 'meta.json'), `${JSON.stringify({
    id: 'minimax-h3-video-prompt',
    version: '2.1.0',
    apiVersion: '1',
    domain: 'minimax-h3',
    entry: true,
    dependencies: [],
    sourceSha256: sha256(skillMdText),
    capabilities: ['h3.compile'],
  }, null, 2)}\n`, 'utf8');
  writeFileSync(join(tamperDir, 'rules.json'), `${JSON.stringify({
    skillId: 'minimax-h3-video-prompt', version: '2.1.0', apiVersion: '1', sourceSha256: sha256(skillMdText), sections: [],
  }, null, 2)}\n`, 'utf8');
  writeFileSync(join(tamperDir, 'prompt.md'), '假包的 AI 段。\n', 'utf8');
}

/** 铺好坏清单 fixture（协议版本不匹配）。 */
function writeBadCatalog(apiVersion: string): void {
  mkdirSync(join(badCatalogBase, 'resources', 'skills'), { recursive: true });
  writeFileSync(badCatalogPath, `${JSON.stringify({
    apiVersion,
    packages: [{ id: 'x', version: '1.0.0', sourceSha256: 'a'.repeat(64) }],
  }, null, 2)}\n`, 'utf8');
}

beforeAll(() => {
  clearSkillCache();
  writeFixture();
});

describe('P2 · 目录清单', () => {
  it('入口包唯一，四个依赖包齐备，list 里的落点都能在盘上还原', () => {
    const entries = loadCatalog([repo]);
    expect(entries.map((item) => item.id).sort()).toEqual(packageIds);
    expect(entries.filter((item) => item.entry).map((item) => item.id)).toEqual(['minimax-h3-video-prompt']);
    for (const item of entries) {
      expect(existsSync(join(skillsRoot, ...item.path.split('/'), 'meta.json'))).toBe(true);
    }
  });

  it('落点查找链：先 resources/skills，后 skills（打包态 extraResources 的投放位）', () => {
    const roots = skillRoots(['/base']);
    expect(roots).toHaveLength(2);
    expect(roots[0].endsWith(join('resources', 'skills'))).toBe(true);
    expect(roots[1].endsWith(join('base', 'skills'))).toBe(true);
    // 同一个 base 重复传入不产生重复候选。
    expect(skillRoots(['/base', '/base'])).toEqual(roots);
  });

  it('catalog.json 与包内 meta.json 逐字段一致（防「只改一处」）', () => {
    for (const item of loadCatalog([repo])) {
      const meta = readMeta(join(skillsRoot, ...item.path.split('/')));
      expect(item.id).toBe(meta.id);
      expect(item.version).toBe(meta.version);
      expect(item.sourceSha256).toBe(meta.sourceSha256);
      expect(item.capabilities).toEqual(meta.capabilities);
      expect(item.dependencies).toEqual(meta.dependencies);
    }
  });

  it('依赖解析：依赖在前、入口在后（按 manifest 自动装载的顺序）', () => {
    const ordered = resolveOrder(loadCatalog([repo]));
    expect(ordered).toHaveLength(5);
    expect(ordered[ordered.length - 1].id).toBe('minimax-h3-video-prompt');
    const entryIndex = ordered.findIndex((item) => item.id === 'minimax-h3-video-prompt');
    for (const dependency of packageIds.filter((id) => id !== 'minimax-h3-video-prompt')) {
      expect(ordered.findIndex((item) => item.id === dependency)).toBeLessThan(entryIndex);
    }
  });

  it('catalog.json 缺失时扫盘生成，条目与带清单的结果逐字段同构', () => {
    const listed = loadCatalog([repo]);
    const scanned = scanCatalog(skillsRoot);
    expect(scanned.map((item) => item.id).sort()).toEqual(packageIds);
    for (const item of scanned) {
      const reference = listed.find((other) => other.id === item.id);
      expect(reference).toBeDefined();
      expect(item).toEqual(reference);
    }
  });

  it('手工最小包 fixture 也能被扫盘识别（无 catalog.json 的目录形态）', () => {
    clearSkillCache();
    const found = loadCatalog([tamperBase]);
    expect(found.map((item) => item.id)).toEqual(['minimax-h3-video-prompt']);
    expect(found[0].path).toBe('minimax-h3/minimax-h3-video-prompt/2.1.0');
    clearSkillCache();
  });
});

describe('P2 · 完整性校验（包内 hash 改一位即报错）', () => {
  it('五个真实包的 SKILL.md 与 manifest 登记的 sourceSha256 全部对得上', () => {
    for (const item of loadCatalog([repo])) {
      const integrity = verifySkill(item.id, [repo]);
      expect(integrity).toMatchObject({ ok: true, skillId: item.id });
      expect(integrity.actual).toHaveLength(64);
      expect(integrity.actual).toBe(item.sourceSha256);
    }
  });

  it('SKILL.md 改一个字符 → verifySkill 转为假（expected 不变、actual 改变）', () => {
    clearSkillCache();
    const before = verifySkill('minimax-h3-video-prompt', [tamperBase]);
    expect(before.ok).toBe(true);

    const skillMd = join(tamperDir, 'SKILL.md');
    writeFileSync(skillMd, `${readFileSync(skillMd, 'utf8')}X`, 'utf8');
    clearSkillCache();

    const after = verifySkill('minimax-h3-video-prompt', [tamperBase]);
    expect(after.ok).toBe(false);
    expect(after.expected).toBe(before.expected);
    expect(after.actual).not.toBe(before.actual);

    writeFixture();
    clearSkillCache();
  });

  it('SKILL.md 被改动后 loadSkill 拒绝装载（错误文案指明两串锚）', () => {
    clearSkillCache();
    const skillMd = join(tamperDir, 'SKILL.md');
    writeFileSync(skillMd, `${readFileSync(skillMd, 'utf8')}Y`, 'utf8');
    clearSkillCache();
    expect(() => loadSkill('minimax-h3-video-prompt', [tamperBase])).toThrow(/完整性校验失败/u);
    expect(() => loadSkill('minimax-h3-video-prompt', [tamperBase])).toThrow(/拒绝装载/u);
    writeFixture();
    clearSkillCache();
  });

  it('meta.json 的源锚被换掉同样拦下（改哪一侧都算脱节）', () => {
    clearSkillCache();
    const metaPath = join(tamperDir, 'meta.json');
    const original = readFileSync(metaPath, 'utf8');
    const meta = JSON.parse(original) as Record<string, unknown>;
    writeFileSync(metaPath, `${JSON.stringify({ ...meta, sourceSha256: '0'.repeat(64) }, null, 2)}\n`, 'utf8');
    clearSkillCache();
    expect(() => loadSkill('minimax-h3-video-prompt', [tamperBase])).toThrow(/完整性校验失败/u);
    writeFileSync(metaPath, original, 'utf8');
    clearSkillCache();
  });

  it('未找到的包不会伪装成校验通过', () => {
    clearSkillCache();
    const missing = verifySkill('minimax-h3-video-prompt', [missingBase]);
    expect(missing).toEqual({ ok: false, skillId: 'minimax-h3-video-prompt', expected: '', actual: '' });
    clearSkillCache();
  });
});

describe('P2 · 降级（拆掉包目录仍能跑）', () => {
  it('无任何包目录：清单回空、根为 null、装载抛可读错误且列出查找链', () => {
    clearSkillCache();
    expect(loadCatalog([missingBase])).toEqual([]);
    expect(findSkillRoot(skillRoots([missingBase]))).toBeNull();
    expect(() => loadSkill('minimax-h3-video-prompt', [missingBase])).toThrow(/未找到 skill 包/u);
    expect(() => loadSkill('minimax-h3-video-prompt', [missingBase])).toThrow(/已查找/u);
    clearSkillCache();
  });

  it('渲染层无桥（浏览器 dev / Vitest）时回落内置默认包，且禁词表逐字一致', async () => {
    resetSkillsCache();
    expect(hasSkillBridge()).toBe(false);
    expect(entrySkillPackage()).toBeNull();
    await expect(ensureSkills()).resolves.toEqual([]);
    expect(entrySkillPackage()).toBeNull();
    expect(forbiddenWords()).toEqual(transitionForbiddenWords);
    expect([...forbiddenWords()]).toHaveLength(27);
    expect(skillStamp()).toEqual([{ skillId: builtinStamp.skillId, version: builtinStamp.version, hash: 'builtin' }]);
  });

  it('降级锚不伪造 SHA-256：hash 记 builtin，与真实包的 64 位锚可区分', () => {
    resetSkillsCache();
    expect(builtinStamp.hash).toBe('builtin');
    expect(builtinStamp.hash).not.toMatch(/^[0-9a-f]{64}$/u);
    expect(skillStamp()[0].hash).toBe('builtin');
  });

  it('反复装载失败不会污染缓存：修好后仍能读到真实清单', () => {
    clearSkillCache();
    expect(loadCatalog([missingBase])).toEqual([]);
    expect(loadCatalog([repo])).toHaveLength(5);
    clearSkillCache();
  });
});

describe('P2 · 盘上 rules.json 与内置默认包逐字一致（行为零变化的依据）', () => {
  it('h3.compile / h3.validate 节与 skill-default 同值', () => {
    const pkg = loadSkill('minimax-h3-video-prompt', [repo]);
    expect(sectionOf(pkg, 'h3.compile')?.allowedKeys).toEqual([...h3CompileAllowedKeys]);
    expect(sectionOf(pkg, 'h3.compile')?.allowedKeys).toHaveLength(11);
    expect(sectionOf(pkg, 'h3.validate')?.issuePolicy).toEqual(issuePolicy);
    expect(sectionOf(pkg, 'h3.validate')?.categoryNames).toEqual(issueCategoryNames);
    expect(sectionOf(pkg, 'h3.validate')?.ignorableCategories).toEqual([...ignorableIssueCategories]);
  });

  it('transition.guard 节：27 条禁词与 11 条正向池逐词逐序', () => {
    const guard = loadSkill('ai-manhua-storyboard-qa', [repo]);
    const section = sectionOf(guard, 'transition.guard');
    expect(section?.forbidden).toEqual([...transitionForbiddenWords]);
    expect(section?.forbidden).toHaveLength(27);
    expect(section?.positivePool).toEqual([...transitionPositivePool]);
    expect(section?.positivePool).toHaveLength(11);
    expect(String(section?.requiredShape)).toBe('衔接须写明手段 + 匹配的具体元素');
  });

  it('skeleton.fields 节：14 格骨架与生成 / 禁改两表逐字', () => {
    const skeleton = loadSkill('ai-manhua-screenplay-comprehensive', [repo]);
    const section = sectionOf(skeleton, 'skeleton.fields');
    expect(section?.fields).toEqual(skeletonFields.map((field) => ({ key: field.key, label: field.label })));
    expect(section?.fields).toHaveLength(14);
    expect(section?.generatedKeys).toEqual([...skeletonGeneratedKeys]);
    expect(section?.protectedKeys).toEqual([...skeletonProtectedKeys]);
  });

  it('director.intent 节：11 条成稿文案与段末三口径同值', () => {
    const intent = loadSkill('ai-manhua-director-thinking', [repo]);
    const section = sectionOf(intent, 'director.intent');
    expect(section?.templates).toEqual(transitionTemplates);
    expect(section?.segmentTail).toEqual(segmentTailTransition);
  });

  it('emotion-clip 的 rules.json 无判据节（L1 策略非 L0 判据），装载仍应成功', () => {
    const pkg = loadSkill('ai-manhua-emotion-clip', [repo]);
    expect(pkg.rules.sections).toEqual([]);
    expect(sectionOf(pkg, 'emotion.design')).toBeNull();
    // 它对 AI 段仍有供给（prompt.md 存在），故不能被当作空包丢弃
    expect(pkg.meta.consumers?.ai).toContain('prompt.md');
  });

  it('入口包的 prompt.md 是 AI 段正本（拼进 system 的内容）', () => {
    const pkg = loadSkill('minimax-h3-video-prompt', [repo]);
    expect(pkg.prompt).toContain('你是分镜导演助理');
    expect(pkg.prompt).toContain('衔接字段禁止使用：');
    expect(pkg.prompt).toContain('不得手改');
  });
});

describe('P2 · schema 闸门', () => {
  it('apiVersion 不匹配即拒绝装载清单', () => {
    writeBadCatalog('2');
    clearSkillCache();
    expect(() => loadCatalog([badCatalogBase])).toThrow(/校验失败/u);
    expect(() => loadCatalog([badCatalogBase])).toThrow(/apiVersion/u);
    clearSkillCache();
  });

  it('清单条目不合格即报错，并指名是哪个包', () => {
    writeBadCatalog('1');
    clearSkillCache();
    expect(() => loadCatalog([badCatalogBase])).toThrow(/条目不合格/u);
    expect(() => loadCatalog([badCatalogBase])).toThrow(/「x」/u);
    clearSkillCache();
  });

  it('meta.json 缺 sourceSha256 即拒绝（源锚是必填项，不是可选装饰）', () => {
    const result = skillMetaSchema.safeParse({ id: 'x', version: '1.0.0', apiVersion: '1' });
    expect(result.success).toBe(false);
    if (!result.success) expect(formatIssues(result.error)).toContain('sourceSha256');
  });

  it('sourceSha256 形状不合法即拒绝（必须 64 位小写十六进制）', () => {
    const base = { id: 'x', version: '1.0.0', apiVersion: '1' };
    expect(skillMetaSchema.safeParse({ ...base, sourceSha256: 'ABC123' }).success).toBe(false);
    expect(skillMetaSchema.safeParse({ ...base, sourceSha256: 'A'.repeat(64) }).success).toBe(false);
    expect(skillMetaSchema.safeParse({ ...base, sourceSha256: 'a'.repeat(64) }).success).toBe(true);
  });

  it('未知字段放行（未来 capability 扩容不该让旧加载器炸）', () => {
    const parsed = skillMetaSchema.safeParse({ id: 'x', version: '1.0.0', apiVersion: '1', sourceSha256: 'a'.repeat(64), futureField: 1 });
    expect(parsed.success).toBe(true);
  });

  it('清单条目不要求 apiVersion（协议版本只在顶层声明一次）', () => {
    const head = skillCatalogSchema.safeParse({
      apiVersion: '1',
      packages: [{ id: 'x', version: '1.0.0', sourceSha256: 'a'.repeat(64), path: 'a/x/1.0.0' }],
    });
    expect(head.success).toBe(true);
    // 但顶层协议版本仍是硬闸
    expect(skillCatalogSchema.safeParse({ apiVersion: '9', packages: [] }).success).toBe(false);
  });

  it('formatIssues 把 zod 报错压成「路径: 说明」的单行文案', () => {
    const result = skillMetaSchema.safeParse({ version: '1.0.0', apiVersion: '1', sourceSha256: 'a'.repeat(64) });
    expect(result.success).toBe(false);
    if (!result.success) {
      const text = formatIssues(result.error);
      expect(text).toContain('id');
      expect(text).not.toContain('{');
    }
  });
});
