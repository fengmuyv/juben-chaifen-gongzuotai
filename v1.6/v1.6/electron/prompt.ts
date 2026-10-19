/**
 * 主进程侧的**提示词与生成通道判据正本**。
 *
 * ### 为什么单独成模块（P2）
 * ① 施工方案 §2.4 要求每个 skill 包带一份 `prompt.md`（AI 段）—— 它必须是**从正本抽取**的，
 *    不能再在生成脚本里抄一份，否则 `prompt.md` 与真正发出去的 system prompt 会各走各的；
 * ② 收拢前，禁词表在本文件与 `script.ts` 内各有一份（27 条 × 2），改一处漏一处。
 *
 * ### P3 起本文件的地位 = **内置兜底**（与渲染层 `skill-default.ts` 完全同构）
 * 运行时的生效判据由 `./skills/feeds.ts` **从 skill 包读取**（`rules.json` 的 `transition.guard` /
 * `h3.compile` 两节），读不到包（未装 / 损坏 / 浏览器侧）才回落到本文件的内置表。
 * 因此本文件与包**不再是双写**：包由本文件与渲染层正本**机器抽取**生成（`scripts/build-skill-packages.mjs`），
 * 两者内容一致是有脚本保证的，而不是靠人记得同步。
 *
 * 对外保留 `systemPrompt`（内置兜底拼出的成品）以兼容既有引用；新增工厂函数供运行时按生效词表重拼。
 *
 * ⚠️ 本文件**不得 import `electron` 运行时**（要能被 esbuild 打包、被单测直接导入）。
 */

/** 生成通道只允许这 11 条；①②④⑫ 由既有链路注入，任何情况不得由模型改写。 */
export const allowedKeys = ['scale', 'composition', 'lens', 'movement', 'light', 'atmosphere', 'blocking', 'action', 'performance', 'sound', 'transition'] as const;

/**
 * 白名单的**字面量类型**。`feeds.ts` 用它约束从包内读到的 `allowedKeys`，
 * 使「包声明了一个不存在的字段名」在取值层就被拦下（整份回落内置），
 * 而不是带着一个多余键一路走到网关输出。
 */
export type AllowedKey = (typeof allowedKeys)[number];

/**
 * ⑭ 衔接禁词（27 条）—— **内置兜底**。运行时生效值见 `./skills/feeds.ts`。
 * 正本 = `ai-manhua-storyboard-qa/scripts/verify.py` → `TRANSITION_KEYWORDS`（v1.6 · 2026-09-27 用户令）。
 * ⚠️ 「推/拉/摇/移」只在作为**转场手段**时禁用，故用「单纯推」「推镜转场」这类组合词，
 *    避免误伤 ④ 运镜字段的正常或极缓推拉摇移。
 */
export const transitionForbiddenWords = [
  '渐黑', '渐白', '黑屏', '黑场', '白屏', '白场', '闪黑', '闪白',
  '叠化', '交叉溶解', '溶解', '淡入', '淡出', '淡入淡出',
  '推镜转场', '拉镜转场', '推拉转场', '摇镜转场', '移镜转场', '单纯推', '单纯拉', '单纯摇', '单纯移',
  '定格转场', '定格收尾', '锁帧', '冻结画面',
] as const;

/** 内置兜底词表对应的正则（由词表构造，正则与数组永不脱节；全部为中文词，无正则元字符）。 */
export const forbiddenTransition = new RegExp(transitionForbiddenWords.join('|'), 'u');

/** 由任意词表构造禁词正则：运行时换用包内词表时走这里，保证正则与词表仍是一对一。 */
export function transitionPatternFor(words: readonly string[]): RegExp {
  return new RegExp(words.join('|'), 'u');
}

/** system prompt 的头部三行（身份声明、输出结构、请求结构）。 */
export const systemPromptPreamble = [
  '你是分镜导演助理。只输出 JSON，不要任何解释、前言或 Markdown 代码围栏。',
  `输出结构：{"shots":[{"shotId":"SC01",${allowedKeys.map((key) => `"${key}":"…"`).join(',')}}]}`,
  `请求结构：{"segment":{"id":"…","mode":"…","shots":[{"id","duration","beatText","dialogue"}]},"context":{"contentType","mode","characters","scene","imageDescriptions","previousBlocking","previousLight","previousTransition","script","cast","arc","previousShots"}}`,
];

/**
 * system prompt 的 12 条规则（正本）。
 *
 * 第 3 条的禁词清单**由传入词表拼出**，不另抄一份 —— 这是「提示词与闸门同源」的关键：
 * 闸门用哪份词表，发给模型的就写哪份词表。
 *
 * **P3 改动（§4.2 第 2/3/4/6 项）**：
 * - 第 7/8/9 条由「照抄 beatText、无证据填无」改为 **「原稿证据优先，无证据时按情绪走势与人物弧光位置
 *   设计，仅空镜填无」** —— 与本地 `director.ts` 的 `sourceFieldsForShot` 口径**逐条对齐**。
 *   本地能设计、AI 只能照抄，是两条引擎输出质量差距的最大来源。
 * - 第 4 条放开自拟衔接，但**必须写明匹配元素**；第 5 条把姓名约束改为「只准用 `context.cast`」。
 * - 新增第 11 条（③⑤⑥ 同档位，按入画人数判定）与第 12 条（不截断上下文的使用方式）。
 */
export function systemPromptRulesFor(forbidden: readonly string[]): string[] {
  return [
    '1. 只能输出上述 11 个字段，禁止输出人物参考图描述、场景参考图描述、台词/内心OS；构图必须输出；',
    '2. 台词与原稿一致，不得改写、增删；',
    `3. 衔接字段禁止使用：${forbidden.join('、')}；注意「推/拉/摇/移」仅在作为转场手段时才禁用，④ 运镜字段的正常或极缓推拉摇移不受此限；`,
    '4. 衔接：可用手段有「动作接动作、视线引导、遮挡转场、匹配剪辑、J-Cut/L-Cut、声音先入、空镜缓冲、同向运动顺接、光影变化接、焦点转移接」，也可自拟接法，但每一条都必须写明「本镜的什么元素」接到「下一镜的什么元素」（谁的手、什么物体、往哪个方向）—— 只写手段名不算合格；不得使用第 3 条的禁用词；',
    '5. 只能使用 context.cast 名单内的姓名；名单外的姓名一律不得出现，禁止用「人物」「主要人物」「他/她」泛指；同镜出现两人时写明分列画面左右三分之一；',
    '6. 构图必须与景别、人物站位一致（主体位置不得与站位相反），并写明视线焦点、景深层次、留白、框中框或纵深引导；原稿没有的动作、道具、人物一律不得写进构图；',
    '7. 肢体动作：beatText 有明确身体动作时照抄，并写出方位或动线；beatText 没有时，参照 context.arc 给出的弧光位置设计一个**可执行**的动作，同样写明方位或动线；禁止只写情绪（如「紧张地站着」）；仅当本镜无人物入画（空镜）才填「无」，且不得凭空补出人物；',
    '8. 微表情：优先取 beatText 中明确出现的眉眼、嘴角、泪、呼吸、颤抖等可观察变化；没有证据时参照 context.arc 的弧光位置设计**肌群级可执行**变化（如「眉峰下压、下颌绷紧」），**禁止情绪形容词**（如「悲伤」「愤怒」）；仅空镜填「无」；',
    '9. 音效：优先取 beatText 中明确出现的声音（拟声、器物碰撞、脚步、呼吸等）；没有声音证据时，给出本场次的空间底噪（按场次标题的内/外景与昼夜判断，如「雨打窗棂」「远处车流」），不得编造对白、配乐或剧情音效（打斗嘶吼、爆炸等）；空镜也须给底噪；',
    '10. shots 数组必须与输入镜头一一对应，数量与 shotId 完全一致，全部字段不得为空字符串；',
    '11. 景别（③）、焦距（⑤）、运镜（⑥）三者必须同档位，按本镜入画人数判定：两人同框用双人档（③ 中近景 / ⑤ 中焦 / ⑥ 稳定横移或轻微推近）；无人物入画（空镜）用空间档（③ 大全景或全景 / ⑤ 广角 / ⑥ 慢速横移或缓推）；其余单人镜用常规档（③ 近景至中景 / ⑤ 标准 / ⑥ 随动作小幅跟随）；三者不得互相矛盾；',
    '12. 不截断上下文：context.script 是本集原文（本段之前的所有场次都在内），对证据有疑问时以它为准；context.previousShots 是上一段已定稿的逐镜结果（含全部 11 字段），本段必须承接其光源链路与站位左右关系 —— 同一场次内同一个人不得换边，光源与氛围不得无故跳变；',
  ];
}

/** 按给定禁词表拼出最终发给模型的 system prompt（头部 + 「规则：」+ 11 条）。 */
export function systemPromptFor(forbidden: readonly string[]): string {
  return [...systemPromptPreamble, '规则：', ...systemPromptRulesFor(forbidden)].join('\n');
}

/** 内置兜底拼出的 system prompt（无包时使用；有包时由 `./skills/feeds.ts` 按包内词表重拼）。 */
export const systemPrompt = systemPromptFor(transitionForbiddenWords);
