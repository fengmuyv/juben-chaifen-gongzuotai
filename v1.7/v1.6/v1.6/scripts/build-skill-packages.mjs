#!/usr/bin/env node
/**
 * 生成 `resources/skills/` 下的 skill 磁盘包（P2 · 加载器接线的数据源）。
 *
 * 三条设计原则：
 * ① **内容全部从正本抽取，脚本不做主观提炼** ——
 *    `rules.json` 取自 `src/platforms/minimax-h3/skill-default.ts`，
 *    入口包的 `prompt.md` 取自 `electron/prompt.ts`。
 *    这样「盘上的包」与「内存里的判据」必然一致，不需要靠人工同步；
 *    人也因此**不该手改产物** —— 改口径请改正本后重跑本脚本。
 * ② **SKILL.md 原文照搬**（`sourceSha256` 对它计算）：它是「人读正本 + 溯源锚」，
 *    运行时不读（`meta.json` 的 `sourcePath` 只作溯源记录）。上游技能演进后，
 *    靠 `sourceSha256` 发现漂移，而不是靠人记得。
 * ③ **产物可复现**：不写生成时间戳 —— 否则每次重跑都产生 git diff，包就成了噪音。
 *
 * 版本号取**上游 frontmatter 的真实值**，不取方案文档里的示例值：
 * 方案 §2.1 写的 `ai-manhua-director-thinking/3.8.0` 与 `ai-manhua-storyboard-qa/1.6.0`
 * 在生成时刻已分别演进到 **3.9.1 / 1.8.0**（同 §8.2 记的那类漂移）。
 *
 * 用法：`node scripts/build-skill-packages.mjs`
 * 上游技能库默认取 `%USERPROFILE%\.workbuddy\skills`，可用 `WORKBENCH_SKILLS_HOME` 覆盖。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outRoot = join(root, 'resources', 'skills');
const tempDir = join(root, '.workbuddy', 'temp', 'skill-packages');
const skillsHome = process.env.WORKBENCH_SKILLS_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.workbuddy', 'skills');

const API_VERSION = '1';
const DOMAIN = 'minimax-h3';

/**
 * 包清单（首版范围裁定 2026-10-05：只装 MiniMax 专项包）。
 * **唯一可见入口** = `minimax-h3-video-prompt`；四个依赖由 manifest 自动解析装载，界面不单独列出。
 * 剧型路由包（short-drama-factory / mid-drama / long-drama / film / …）一律不装载。
 */
const PACKAGES = [
  {
    id: 'minimax-h3-video-prompt',
    version: '2.1.0',
    entry: true,
    capabilities: ['h3.compile', 'h3.validate'],
    dependencies: [
      { id: 'ai-manhua-director-thinking', version: '^3.9.1' },
      { id: 'ai-manhua-emotion-clip', version: '^1.0.1' },
      { id: 'ai-manhua-storyboard-qa', version: '^1.8.0' },
      { id: 'ai-manhua-screenplay-comprehensive', version: '^2.6.0' },
    ],
    localSections: ['h3.compile', 'h3.validate'],
    promptKind: 'entry',
  },
  {
    id: 'ai-manhua-storyboard-qa',
    version: '1.8.0',
    entry: false,
    capabilities: ['transition.guard'],
    dependencies: [],
    localSections: ['transition.guard'],
    promptKind: 'transition',
  },
  {
    id: 'ai-manhua-director-thinking',
    version: '3.9.1',
    entry: false,
    capabilities: ['director.intent', 'staging.anchor'],
    dependencies: [],
    localSections: ['director.intent'],
    promptKind: 'director',
  },
  {
    id: 'ai-manhua-screenplay-comprehensive',
    version: '2.6.0',
    entry: false,
    capabilities: ['skeleton.fields'],
    dependencies: [],
    localSections: ['skeleton.fields'],
    promptKind: 'skeleton',
  },
  {
    id: 'ai-manhua-emotion-clip',
    version: '1.0.1',
    entry: false,
    capabilities: ['emotion.design'],
    dependencies: [],
    // 诚实标注：本包贡献的是 L1 生成策略（情绪档 × 弧光强度），**不含 L0 判据** ——
    // 其口径落在 `director.ts` 的情绪档表里，属「各引擎适配层」，不搬进判据包。
    localSections: [],
    promptKind: 'emotion',
  },
];

/** 用 esbuild 把 TS 正本打成临时 ESM 再 import —— 避免在脚本里复制一份数据。 */
async function loadModule(entry) {
  await mkdir(tempDir, { recursive: true });
  const outfile = join(tempDir, `${basename(entry).replace(/\.[^.]+$/u, '')}.mjs`);
  await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

/** 抓取第 n 个代码围栏之外的正文章节（本脚本只用于从 SKILL.md 取标题，不做提炼）。 */
function firstHeading(skillText) {
  const match = /^#\s+(.+)$/mu.exec(skillText);
  return match ? match[1].trim() : '(无一级标题)';
}

/** capability → rules.json 的节体，全部从 `skill-default.ts` 的正本对象直接搬运。 */
function sectionFor(capability, d, p) {
  switch (capability) {
    case 'h3.compile':
      return { capability, allowedKeys: [...d.h3CompileAllowedKeys] };
    case 'h3.validate':
      return {
        capability,
        issuePolicy: d.issuePolicy,
        categoryNames: d.issueCategoryNames,
        ignorableCategories: [...d.ignorableIssueCategories],
        /** 分级口径：`error` 只限事实类与内容安全，人工确认类一律 `review`。 */
        severityRule: 'error 仅限 input/reference/source 三类事实问题与 safety 内容安全；其余一律 warning',
      };
    case 'transition.guard':
      return {
        capability,
        forbidden: [...d.transitionForbiddenWords],
        forbiddenNote: '推/拉/摇/移 仅作为转场手段时禁用，④ 运镜字段的正常或极缓推拉摇移不受此限',
        positivePool: [...d.transitionPositivePool],
        requiredShape: d.transitionRequiredShape,
      };
    case 'director.intent':
      return { capability, templates: d.transitionTemplates, segmentTail: d.segmentTailTransition };
    case 'skeleton.fields':
      return {
        capability,
        fields: d.skeletonFields,
        generatedKeys: [...d.skeletonGeneratedKeys],
        protectedKeys: [...d.skeletonProtectedKeys],
      };
    default:
      throw new Error(`未知 capability：${capability}`);
  }
}

/** prompt.md = 「可直接拼进 system 的 AI 段」。内容一律来自正本，脚本不添笔。 */
function promptFor(kind, d, p) {
  const header = (title, source) => `# AI 段 · ${title}\n\n> 由 \`${source}\` 抽取生成，**不得手改**；改口径请改正本后重跑 \`node scripts/build-skill-packages.mjs\`。\n`;
  switch (kind) {
    case 'entry':
      return `${header('system prompt 正本', 'electron/prompt.ts')}\n运行时由主进程读取并作为请求的 \`system\` 字段发出。\n\n\`\`\`\n${p.systemPrompt}\n\`\`\`\n`;
    case 'transition':
      return `${header('transition.guard', 'src/platforms/minimax-h3/skill-default.ts')}
## 禁止（⑭ 衔接命中即阻断，共 ${d.transitionForbiddenWords.length} 条）

${d.transitionForbiddenWords.join('、')}

## 可用手段（共 ${d.transitionPositivePool.length} 条）

${d.transitionPositivePool.join('、')}

## 成稿形态

${d.transitionRequiredShape}
`;
    case 'director':
      return `${header('director.intent', 'src/platforms/minimax-h3/skill-default.ts')}
## 镜内衔接成稿池（${Object.keys(d.transitionTemplates).length} 条，选型须按证据 + 前提过滤，禁按序号盲选）

${Object.entries(d.transitionTemplates).map(([key, text]) => `- \`${key}\`：${text}`).join('\n')}

## 段末口径（${Object.keys(d.segmentTailTransition).length} 条）

${Object.entries(d.segmentTailTransition).map(([key, text]) => `- \`${key}\`：${text}`).join('\n')}
`;
    case 'skeleton':
      return `${header('skeleton.fields', 'src/platforms/minimax-h3/skill-default.ts')}
## 14 格骨架（编号、顺序、标签一个不改）

${d.skeletonFields.map((field, index) => `${String.fromCharCode(0x2460 + index)} ${field.label}（\`${field.key}\`）`).join('\n')}

## 生成通道可填（${d.skeletonGeneratedKeys.length} 条）

${d.skeletonGeneratedKeys.join('、')}

## 禁改（${d.skeletonProtectedKeys.length} 条）

${d.skeletonProtectedKeys.join('、')}
`;
    case 'emotion':
      return `${header('emotion.design（L1 策略，非 L0 判据）', 'src/platforms/minimax-h3/director.ts')}
本包**不含 L0 判据节**（\`rules.json\` 的 \`sections\` 为空数组，属如实标注、非漏抄）：
情绪档 × 弧光强度的设计口径属施工方案 §4.1 的 **L1 生成策略**，归各引擎适配层，
实现见 \`src/platforms/minimax-h3/director.ts\` 的情绪档表，**不搬进判据包**（否则本地引擎与 AI 侧的
「同一件事两种写法」会被固化）。

本包对交付的贡献在方法学层：15 秒单人情绪短片的**情绪七段式骨架**（僵住 / 裂开 / 下坠 / 复位 /
爆发 / 凝固 / 余韵，8–30 秒自适应换算）与**动作锚点机制**。人读正本见同目录 \`SKILL.md\`。
`;
    default:
      throw new Error(`未知 promptKind：${kind}`);
  }
}

async function main() {
  const d = await loadModule(join(root, 'src', 'platforms', 'minimax-h3', 'skill-default.ts'));
  const p = await loadModule(join(root, 'electron', 'prompt.ts'));

  const catalog = { apiVersion: API_VERSION, domain: DOMAIN, entry: 'minimax-h3-video-prompt', packages: [] };

  for (const item of PACKAGES) {
    const sourcePath = join(skillsHome, item.id, 'SKILL.md');
    let skillText;
    try {
      skillText = await readFile(sourcePath, 'utf8');
    } catch {
      throw new Error(`上游技能正本缺失：${sourcePath}\n（可用 WORKBENCH_SKILLS_HOME 指定技能库根目录）`);
    }
    const dir = item.entry
      ? join(outRoot, DOMAIN, item.id, item.version)
      : join(outRoot, DOMAIN, 'deps', item.id, item.version);
    const sourceSha256 = sha256(skillText);

    const meta = {
      id: item.id,
      version: item.version,
      apiVersion: API_VERSION,
      domain: DOMAIN,
      entry: item.entry,
      /** 依赖按 manifest 自动解析装载；版本用 `^` 声明「同主版本兼容」。 */
      dependencies: item.dependencies,
      /** 溯源锚：对上游 `SKILL.md` 全文计算，用于发现上游漂移（运行时不读该文件）。 */
      sourceSha256,
      /** 只作溯源记录，运行时不读（包内文件自足）。 */
      sourcePath: sourcePath.replace(/\\/gu, '/'),
      sourceHeading: firstHeading(skillText),
      capabilities: item.capabilities,
      /** 声明本包对两路各供什么：加载器据此挑段，不整包塞给 AI（省 token）。 */
      consumers: { local: item.localSections.length ? ['rules.json'] : [], ai: ['prompt.md'] },
    };

    const rules = {
      skillId: item.id,
      version: item.version,
      apiVersion: API_VERSION,
      sourceSha256,
      sections: item.localSections.map((capability) => sectionFor(capability, d, p)),
    };

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), skillText, 'utf8');
    await writeJson(join(dir, 'meta.json'), meta);
    await writeJson(join(dir, 'rules.json'), rules);
    await writeFile(join(dir, 'prompt.md'), promptFor(item.promptKind, d, p), 'utf8');

    catalog.packages.push({
      id: item.id, version: item.version, domain: DOMAIN, entry: item.entry,
      capabilities: item.capabilities, dependencies: item.dependencies, sourceSha256,
      path: item.entry ? `${DOMAIN}/${item.id}/${item.version}` : `${DOMAIN}/deps/${item.id}/${item.version}`,
    });
    console.log(`✓ ${item.id}@${item.version} → ${dir.replace(root, '.').replace(/\\/gu, '/')}`);
  }

  await writeJson(join(outRoot, 'catalog.json'), catalog);
  console.log(`✓ catalog.json（${catalog.packages.length} 个包；唯一入口 ${catalog.entry}）`);
}

await main();
