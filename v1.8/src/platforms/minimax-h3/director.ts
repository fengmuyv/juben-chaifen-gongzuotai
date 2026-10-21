import { type Beat, type Episode, type ImageAnalysis, type Project, type Segment, type Shot } from '../../core/model';
import { environmentOnly, isCastName, parseScript, partWords, roleSpeaker, speakerNameOf, subjectStopwords } from '../../core/parser';
import { allocateShotDurations } from '../../core/timing';
import { generatedKeys, type EditableShotKey } from './skeleton';
import { activeForbiddenPattern } from './rules';
import { segmentTailTransition, transitionTemplates } from './skill-default';

/**
 * 规则导演（本地推理）· **判据溯源**
 *
 * 本文件的判据**编译自技能正本** —— 技能是设计正本，本文件是编译产物（技能不在运行时读取，
 * 见技术方案 §5）。各判据的来源对应如下，改本文件前请先核对来源技能是否已改口径：
 *
 * | 本文件判据 | 来源技能 |
 * | --- | --- |
 * | `stagingFor` ⑨ 站位 / 场次轴线锚 · `gradeForShot` ③⑤⑥ 档位单元 · `transitionRules` 前提校验 | `ai-manhua-director-thinking`（L3 导演意图锚） |
 * | `emotionCues` / `emotionDesigns` 十情绪档 × 三强度（肌群级可执行动作） | `ai-manhua-emotion-clip`（L3） |
 * | `sourceFieldsForShot` 证据优先 · `purposeFor` 导演意图 | `一体化编剧与表演标注/SKILL.md` §八（12 字段骨架） |
 * | `activeForbiddenPattern()` 生效禁词（有包走包、无包内置 27 条，见 `./rules`） | `ai-manhua-storyboard-qa`（L4 交付闸门） |
 * | `transitionRules` ⑭ 成稿文案池（11 条 + 段末 3 口径） | `ai-manhua-storyboard-qa` 正向池 / `ai-manhua-director-thinking` |
 *
 * ⚠️ **来源版本与 SHA-256 锚**：⑭ 文案池与本文件用到的禁词表自 P1（2026-10-06 · 判据 JSON 化）
 *    起收拢到 `./skill-default`（其中登记了 capability 与正本出处）；**其余判据仍无锚** ——
 *    技能扩表或改口径时此处不会自动跟随，也没有护栏能发现漂移
 *    （`rules.ts` 的禁词表就曾因此停在 v1.4 口径）。`sourceSha256` 与漂移对账脚本归 P2（见施工方案 §2.2 / §8.2）。
 */

export type BeatCategory = 'action' | 'dialogue' | 'emotion' | 'establish';

/** 生成通道的单镜草稿：承载 11 条可生成字段（③④⑤⑥⑦⑧⑨⑩⑪⑬⑭）。 */
export type ShotDraft = { shotId: string; purpose?: string; duration?: number; fields: Partial<Record<EditableShotKey, string>>; source: 'local' | 'ai' | 'manual' };

const emotionWords = /泪|颤|怔|咬牙|苦笑|冷笑|蹙|皱眉|哽咽|怒|悲|喜|惊|惧|痛|慌|愣|僵|叹|红着眼|沉默/u;
const establishWords = /窗外|门口|大厅|街道|晨|夜|夕阳|黄昏|灯光|桌上|屋内|走廊|天台|楼|车|雨|雪|风|光|远处|背景|房间|墙|院落/u;

/** 节拍分类：动作 / 对话 / 情绪 / 场景建立。动作判定直接复用证据表，避免两套词表互相打架。 */
export function classifyBeat(beat: Beat): BeatCategory {
  if (beat.kind === 'dialogue') {
    if (emotionWords.test(beat.text) && /[！？…]|\.\.\./u.test(beat.text)) return 'emotion';
    return 'dialogue';
  }
  if (hasBodyAction(beat.text)) return 'action';
  if (emotionWords.test(beat.text)) return 'emotion';
  if (establishWords.test(beat.text)) return 'establish';
  return 'establish';
}

/** 镜头档位：③ 景别 与 ⑤ 焦距 / ⑥ 运镜 同属一个档位单元，必须整体升降，不得各自变化。 */
export type ShotGrade = { scale: string; lens: string; movement: string };

/** 镜头模板基准档：动作→中近景·35mm·跟拍；对话→过肩·50mm·静止；情绪→特写·85mm；建立→大全景·24mm。 */
export const shotTemplates: Record<BeatCategory, ShotGrade> = {
  action: { scale: '中近景', lens: '35mm', movement: '手持跟拍' },
  dialogue: { scale: '过肩中景', lens: '50mm', movement: '固定机位' },
  emotion: { scale: '面部特写', lens: '85mm', movement: '微幅前移' },
  establish: { scale: '大全景', lens: '24mm', movement: '缓慢横移' },
};

/**
 * 入画 ≥2 主体：单人档升为双人档。
 * 依据 = ④ 构图的 `pair` 分支本来就按「两人视线相接、两侧各留移动余量」写，
 * 若 ③ 仍写「面部特写」，③ 与 ④ 就自相矛盾（真稿实测 3 例）。
 */
const pairGrades: Record<string, ShotGrade> = {
  面部特写: { scale: '双人中近景', lens: '50mm', movement: '微幅前移' },
  中近景: { scale: '双人中近景', lens: '50mm', movement: '手持跟拍' },
};

/**
 * 入画 0 主体：人物档退为空间档。
 * 空镜 / 内心OS 覆盖镜 / 纯环境镜里没有肩背与面部可拍，写「过肩中景」即张冠李戴
 * （真稿实测 138 镜过肩中景 + 171 镜中近景落在无人物入画的镜头上）。
 */
const emptyGrades: Record<string, ShotGrade> = {
  面部特写: { scale: '大全景', lens: '24mm', movement: '缓慢横移' },
  过肩中景: { scale: '大全景', lens: '24mm', movement: '缓慢横移' },
  中近景: { scale: '全景', lens: '35mm', movement: '缓慢横移' },
};

/** 人物档景别：必须有主体入画，空镜套不住。审计判据与本表同源。 */
const subjectScales = new Set(['面部特写', '过肩中景', '中近景', '双人中近景']);

/** 人脸档景别：收不下两个主体。用正则以覆盖人工自创写法（大特写 / 近景特写）。 */
const faceCloseUpScales = /特写/u;

/**
 * ③ 景别档位的**唯一来源**：节拍类型给基准，入画人数做相容性校正。
 *
 * 校正结果同时驱动 ③ 景别与 ④ 构图的景深层次 —— 两处取同一个 `ShotGrade`，
 * 因此 ③ 与 ④ 在结构上不可能互相矛盾。
 */
export function gradeForShot(category: BeatCategory, subjectCount: number): ShotGrade {
  const base = shotTemplates[category];
  if (subjectCount >= 2) return pairGrades[base.scale] ?? base;
  if (subjectCount === 0) return emptyGrades[base.scale] ?? base;
  return base;
}

/**
 * ③ 景别 × 入画人数的相容性判据（**生成与审计共用的单一来源**）。
 * 相容返回 `null`；不相容返回矛盾说明。人工自创、不在表内的档位一律放行（宁可漏报不误报）。
 */
export function scaleSubjectConflict(scale: string, subjectCount: number): string | null {
  const trimmed = scale.trim();
  if (subjectScales.has(trimmed) && subjectCount === 0) return `「${trimmed}」是人物档景别，但本镜无人物入画`;
  if (faceCloseUpScales.test(trimmed) && subjectCount >= 2) return `「${trimmed}」收不下 ${subjectCount} 个主体`;
  return null;
}

// ── 证据表（单一来源）：所有生成字段只能从原稿可观察证据推导，禁止模板编造 ──────────────

/** 身体动作证据：命中即给出该动作的方位 / 动线。表内顺序即优先级。 */
const bodyActions: [RegExp, string][] = [
  [/推门|推开门/u, '由门外向内，沿画面纵深方向进入'],
  [/走进|走入|进入|进门|踏入|穿过|迈进门/u, '沿画面纵深方向向内移动'],
  [/走出|走开|离开|退出|出门|跑出|冲出|甩门而出/u, '由画面纵深向画外移动'],
  [/走向|走到|走近|靠近|凑近|贴近|上前|迎上|逼近|凑到/u, '沿目标方向横向移动，间距逐步缩短'],
  [/后退|倒退|退开|退步|退回|退到|撤离/u, '背离目标方向后退'],
  [/起身|站起|坐起|撑起身体/u, '重心由低位向高位垂直上移'],
  [/坐下|坐回|落座|瘫坐|坐倒|坐在|坐着|坐到/u, '重心由高位向低位垂直下移'],
  [/蹲下|蹲|跪下|跪倒|跪/u, '重心垂直下沉到低位'],
  [/靠在|倚在|贴墙|背靠/u, '身体向支撑面靠拢，重心落在支撑侧'],
  [/俯身|弯腰|躬身|弯下|伏下|低头|垂下头|垂头/u, '上身前倾下沉，重心向前下方移动'],
  [/抬头|扬起头|仰望/u, '头颈向上抬起，视线转向高处'],
  [/回头|扭头|转过头/u, '头颈绕纵轴回转，视线转向侧后'],
  [/闪避|避开|躲开|躲|避让|侧闪/u, '身体横向位移，让开来向'],
  [/追上|跟上|紧跟|跟在|尾随/u, '紧随对方保持同向位移'],
  [/转身|回身|侧身|探身|转过身|转过脸/u, '身体绕纵轴改变朝向'],
  [/抬手|举起|扬起|抬起/u, '手臂向上抬起至肩以上高度'],
  [/伸手|探手|伸出/u, '手臂向目标方向前伸'],
  [/放下|收回|撤回/u, '手臂由上向下或向身体方向收回'],
  [/拿起|抓起|掏出|取出|端起|拎起|提起|捡起/u, '手部接触目标物后向上提起'],
  [/递给|递出|交出|接过|接住/u, '手部沿两人连线向前送出或接住来物'],
  [/抓住|抓紧|攥住|攥|握紧|握住|捏|掐|拽|扯|揪|拉住|按住|压住|扶住|搂住|抱住|揽住|绑住/u, '手部向目标方向收拢并持续施力'],
  [/松开|放开|撒手|甩手/u, '手部向离心方向张开，解除接触'],
  [/挥|抡|劈|砍|刺|捅|戳|踢|踹|踩|跺|肘击/u, '沿攻击方向快速击出'],
  [/甩|扔|抛|砸|摔|掷/u, '手臂由内向外横向甩出，物体脱手后落地'],
  [/格挡|挡住|架住|挡/u, '手臂横向架在来向，形成阻挡面'],
  [/敲|叩|拍|掴|扇/u, '手部向平面往复或横向挥击'],
  [/扶|搀|背起|扛起|托住/u, '身体承托对方重量并保持同向移动'],
  [/撞|扑向|扑|冲上|冲向/u, '身体沿目标方向快速冲撞'],
  [/停住|停下|停了|驻足|站定|顿住|停在/u, '位移在当前位置终止，重心回收'],
  [/迈步|跨步|踱步|走(?!廊)|跑|奔|冲/u, '腿部交替递出，位移连续推进'],
];

/** 面部 / 呼吸 / 颤抖证据：这些子句进「微表情」，不再重复进「肢体动作」。 */
const facialActions = /皱眉|蹙眉|拧眉|挑眉|眯眼|眯起|睁大眼|睁眼|闭眼|眨眼|垂眼|垂眸|抬眼看|目光|眼神|眼里|眼眶|眼皮|瞳孔|泪|流泪|落泪|掉泪|哭|笑|撇嘴|抿嘴|抿唇|咬唇|嘴唇|唇角|嘴角|牙关|咬牙|下颌|下巴|鼻翼|喉结|脸色|面色|神情|表情|吸气|抽气|叹气|叹息|屏息|屏住呼吸|呼吸|喘息|喘|颤|发抖|哆嗦|红了眼/u;
const facialVerbs = /皱眉|蹙眉|拧眉|挑眉|眯(?:眼|起)|睁(?:大)?眼|闭眼|眨眼|垂眼|垂眸|抬眼看|流泪|落泪|掉泪|泪(?:落|涌|滚|滑|掉|流|湿|光)|红了眼|泛红|哭|笑|撇嘴|抿嘴|抿唇|咬唇|咧嘴|吸气|抽气|叹气|叹息|屏息|屏住呼吸|喘|颤|发抖|哆嗦|咬牙|脸色一变/u;

/** 可执行身体部位：动作子句必须落到具体部位或明确人物，否则不成立。 */
const bodyParts = /手|指|手臂|胳膊|肘|肩|背|腰|腿|脚|膝|头|额|颌|下巴|颈|脖子|身体|身子|重心|掌|拳/u;

/** 注意：人物判据（`partWords` / `environmentOnly` / `subjectStopwords` / `isCastName`）
 *  已归位到 `src/core/parser.ts`，解析期与生成期共用同一份词表；此处只保留生成侧证据表。 */

/** 声音证据：声源 → 该声源发出的声音描述。表内顺序即优先级。 */
const soundSources: [RegExp, string][] = [
  [/雷/u, '雷声'],
  [/雨(?:声|点|水|中|里|下|落|停|丝)/u, '雨声'],
  [/风(?:声|吹|穿|过|起|刮|雨|夜)/u, '风声'],
  [/推门|推[^，。；、]{0,2}门|开门/u, '门被推开的声响'],
  [/关门|合上门|带上门/u, '门合拢的声响'],
  [/敲门|叩门|门响/u, '敲门声'],
  [/脚步|足音|鞋跟|步子/u, '脚步落地的声响'],
  [/铃|电话|手机|震动/u, '铃声'],
  [/钟|表盘|摆钟/u, '钟表走时声'],
  [/敲|叩/u, '指节敲击的声响'],
  [/拍|掴|掌声/u, '拍击声'],
  [/撞|扑/u, '身体撞击的声响'],
  [/摔|砸|掷|坠|甩|落地/u, '落地撞击的声响'],
  [/溅|泼|水渍|水花/u, '水花溅开的声响'],
  [/玻璃|碎裂|破碎|破空/u, '器皿碎裂的声响'],
  [/金属|铁|钥匙|锁|拉链/u, '金属碰响'],
  [/纸|翻页|信封|封蜡/u, '纸张摩擦的声响'],
  [/呼吸|喘息|喘/u, '呼吸声'],
  [/心跳/u, '心跳声'],
  [/叹|叹息/u, '叹息声'],
  [/哽|抽泣|哭声|呜咽/u, '压抑的哭声'],
  [/喊|吼|叫|尖叫|嚷/u, '喊声'],
  [/摩擦|蹭|沙沙/u, '衣物摩擦声'],
  [/火焰|炉火|燃烧|打火机/u, '火焰的声响'],
  [/水声|水流|水滴|龙头|倒水|水杯/u, '水声'],
  [/鸟|蝉|犬|狗吠|蛙鸣/u, '环境虫鸣鸟叫'],
  [/车|引擎|鸣笛/u, '远处车流声'],
  [/音乐|电视|广播|收音机/u, '画内音源的乐声或人声'],
];

/** 景别 → 景深层次。构图与景别共用同一档位，避免两者互相矛盾。 */
const depthByScale: Record<string, string> = {
  大全景: '全景深，前景到远景全部清晰',
  全景: '全景深，近景到中景实焦，远景轻度虚化',
  过肩中景: '前景肩部虚化，中景人物实焦，背景轻度虚化',
  中近景: '中景主体实焦，前后景轻度虚化',
  双人中近景: '双人主体同为实焦，前后景轻度虚化',
  面部特写: '浅景深，面部实焦，背景压虚为色块',
};

/** 空镜（无人物主体）时的景深档位：不写「主体」，只写空间。 */
const spaceDepthByScale: Record<string, string> = {
  大全景: '全景深，前景到远景全部清晰',
  全景: '全景深，空间层次完整',
  过肩中景: '中景实焦，前后景轻度虚化',
  中近景: '中景实焦，前后景轻度虚化',
  面部特写: '浅景深，纵深压虚为色块',
};

/**
 * ⑭ 衔接的选型上下文：只使用**本镜 / 下一镜的可观察证据**，不按序号盲选。
 * 盲选会让空镜写「视线引导」、无台词镜写 L-Cut、无抬手动作的镜写「动作接动作」——
 * 真稿实测 1593 / 4512 镜（35.3%）张冠李戴。
 */
export type TransitionContext = {
  /** 本镜有可信台词（`kind === 'dialogue'`）。 */
  hasDialogue: boolean;
  /** 下一镜有可信台词。 */
  nextHasDialogue: boolean;
  /** 本镜入画人物数（0 = 空镜）。 */
  persons: number;
  /** 本镜 ⑩ 含抬手 / 举起类动作。 */
  handAction: boolean;
  /** 下一镜 ⑩ 含抬手 / 举起类动作。 */
  nextHandAction: boolean;
  /** 本镜 ⑩ 含横向移动。 */
  sideways: boolean;
};

/** ⑩ 里属于「抬手 / 举起」类的手臂动作（与 `bodyActions` 的抬起档同口径）。 */
const handActionPattern = /抬起|举起|扬起|抬手|提起/u;

type TransitionRule = { text: string; when?: (ctx: TransitionContext) => boolean };

/**
 * 合规衔接池：动作接动作、视线引导、遮挡转场、匹配剪辑、J-Cut / L-Cut、声音先入、
 * 空镜缓冲、同向运动顺接、光影变化接、焦点转移接。池内不含具体剧情内容物，避免张冠李戴。
 *
 * **与技能正向池的对应（有意归并，非漏抄 —— 勿据条数差判定缺失）**：
 * 技能 `ai-manhua-storyboard-qa` 的 `TRANSITION_GOOD_KEYWORDS` 为 **13 条**，本池 **11 条**：
 * - 「匹配动作」已并入「动作接动作」（同义，技能自身亦并列二者）
 * - 「声延后」已并入「L-Cut」（L-Cut 定义即「本镜台词延续到下一镜画面」）
 * 其余 11 条一一对应（「声先入」→「声音先入」、「同向运动」→「同向运动顺接」等仅措辞扩展）。
 * **改技能侧正向池时必须回来核对本归并关系。**
 *
 * `when` = **适用前提**：只有镜头内容满足前提才允许选用。无 `when` 的条目为通用衔接，
 * 任何镜头可用，也是禁词替换的兜底池。
 */
/** 文案正本 = `skill-default.ts` 的 `transitionTemplates`（P1 起收拢）；此处 `when` 是本地引擎的适用前提。 */
const transitionRules: TransitionRule[] = [
  { text: transitionTemplates.actionMatch, when: (ctx) => ctx.handAction && ctx.nextHandAction },
  { text: transitionTemplates.eyeLine, when: (ctx) => ctx.persons > 0 },
  // 五要素齐备（技能 v1.8.0「遮挡转场峰值交接完整性」）：遮挡体进场 → 覆盖峰值 → 峰值换景 → 同向退出 → 落点恢复。
  { text: transitionTemplates.occlusion, when: (ctx) => ctx.persons > 0 },
  { text: transitionTemplates.matchCut },
  { text: transitionTemplates.jCut, when: (ctx) => ctx.nextHasDialogue },
  { text: transitionTemplates.lCut, when: (ctx) => ctx.hasDialogue },
  { text: transitionTemplates.soundLead },
  { text: transitionTemplates.emptyBuffer },
  { text: transitionTemplates.sameDirection, when: (ctx) => ctx.persons > 0 && ctx.sideways },
  { text: transitionTemplates.lightShift },
  { text: transitionTemplates.focusShift, when: (ctx) => ctx.persons > 0 },
];

/** 合规衔接文案池（11 条）：仅作文案正本，选型必须走 `pickTransition`。 */
export const transitionPool: string[] = transitionRules.map((rule) => rule.text);

/** 通用衔接（无前提，任何镜头可用）：禁词替换与无合格条目时的兜底。 */
const neutralTransitions = transitionRules.filter((rule) => !rule.when).map((rule) => rule.text);

/** 段末 · 同场次：轴线与人物方位确实不变，可原样承接。 */
const carryTransition = (nextCategory: BeatCategory): string =>
  `交棒下一段：保持轴线与人物方位不变，以${nextCategory === 'action' ? '动作起势' : nextCategory === 'emotion' ? '视线与呼吸' : '环境声'}进入下一段`;

/** 段末 · 换场次：轴线必然按新场次重设，不得再写「方位不变」。文案正本 = `skill-default.ts`。 */
const sceneChangeTransition = segmentTailTransition.sceneChange;

/** 段末 · 本集最后一镜：不再有下一段，不得写「交棒下一段」。文案正本 = `skill-default.ts`。 */
const closingTransition = segmentTailTransition.closing;

/**
 * 按证据选型：只从**满足前提**的条目里取，用确定性序号轮转保证同一条件下多样性。
 * 若一条都不满足（正常不会发生，仍有 4 条通用衔接保底），退回通用池。
 */
export function pickTransition(ctx: TransitionContext, seed: number): string {
  const eligible = transitionRules.filter((rule) => !rule.when || rule.when(ctx));
  const pool = eligible.length ? eligible : neutralTransitions.map((text) => ({ text }));
  return pool[seed % pool.length].text;
}

/**
 * 由本镜 / 下一镜的证据构造选型上下文。**生成端与审计端共用**，
 * 保证「审计判定的前提」与「生成时的前提」永远是同一套口径。
 */
export function transitionContextOf(shot: Shot, evidence: ShotEvidence, nextEvidence?: ShotEvidence, nextShot?: Shot): TransitionContext {
  return {
    hasDialogue: shot.dialogue.some((item) => (item.kind ?? 'dialogue') === 'dialogue'),
    nextHasDialogue: (nextShot?.dialogue ?? []).some((item) => (item.kind ?? 'dialogue') === 'dialogue'),
    persons: evidence.subjects.length,
    handAction: handActionPattern.test(evidence.action),
    nextHandAction: nextEvidence ? handActionPattern.test(nextEvidence.action) : false,
    sideways: evidence.action.includes('横向'),
  };
}

/**
 * 审计用：该衔接文案命中了带前提的条目、但前提不成立（张冠李戴）。
 * 段末的「本集收束 / 换场衔接 / 交棒下一段」不在规则表内，天然跳过。
 */
export function transitionPremiseUnmet(text: string, ctx: TransitionContext): boolean {
  const rule = transitionRules.find((item) => item.text === text);
  return !!rule?.when && !rule.when(ctx);
}

/** 若衔接命中转场禁词，替换为确定性合规衔接（禁词表是硬红线）。 */
export function sanitizeTransition(text: string): string {
  return activeForbiddenPattern().test(text) ? neutralTransitions[0] : text;
}

// ── 人物识别 ────────────────────────────────────────────────────────────────

const castCache = new Map<string, string[]>();
/** 场次轴线锚缓存：同一场次反复取用，保证逐镜锁定同一结果。 */
const anchorCache = new Map<string, string[]>();

/** 取子句里第一个动作证据（身体动作或面部动作）在子句中的位置。 */
function verbIndexIn(clause: string): number {
  let best = -1;
  const consider = (index: number) => { if (index >= 0 && (best < 0 || index < best)) best = index; };
  for (const [pattern] of bodyActions) consider(pattern.exec(clause)?.index ?? -1);
  consider(facialVerbs.exec(clause)?.index ?? -1);
  return best;
}

/** 叙述句主语：动作动词之前是「姓名 + 可选副词」时取姓名（`甲走向桌边` → 甲；`苏清苒猛地转身` → 苏清苒）。 */
const subjectLead = /^([\u4e00-\u9fa5]{1,4}?)(?:猛地|突然|忽然|缓缓|慢慢|迅速|连忙|立刻|马上|用力|一把|已经|正在|终于|这才|先|又|再|便|就|地|的|着|了)?$/u;

/** 不是人物但会被「动词前 1–4 字」捞到的形状：数量 / 动量 / 助词收尾。发现与甄别两侧共用。 */
const countOrPartLike = /^[0-9一二三四五六七八九十两半几数]|步$|声$|下$|次$|遍$|着$|了$|的$/u;

function narrationSubjects(text: string, push: (name: string) => void): void {
  for (const clause of clausesOf(text)) {
    const index = verbIndexIn(clause);
    if (index <= 0) continue;
    const match = subjectLead.exec(clause.slice(0, index).trim());
    if (!match) continue;
    const name = match[1];
    // 身体部位（指尖 / 脚步 / 肩膀）、短部位词（眼）与数量副词（一步一步）不是人物。
    if (bodyParts.test(name)) continue;
    if (countOrPartLike.test(name)) continue;
    push(name);
  }
}

/**
 * 整本原稿人物名册（**唯一发现通道**）：人物设定块内的姓名 + 可信台词说话人。
 *
 * 口径（2026-10-01 修）：**叙述句主语不再「发现」人物，只做「佐证」** ——
 * 原实现把「动词之前 1~4 字」当姓名，真稿上产出 35 条仅 3 条为人（`冯京一` / `慢慢` / `让她` /
 * `同一` / `椅子` / `往门口` / `用凉水`…），污染 ⑨ 站位。现只接受两类补登：
 * ① 已确证姓名（用于登记其在原文的出现次序）；② 命中单一来源角色称谓表 `roleSpeaker` 的泛称
 * （小女孩 / 老人 / 鬼子兵 —— 真实入画但从不说话的人物）。频次阈值不可用（`同一` 出现 68 次仍非人物）。
 */
export function projectCast(project: Project): string[] {
  const text = project.scripts.map((script) => script.text).join('\n');
  const cached = castCache.get(text);
  if (cached) return cached;
  const names: string[] = [];
  const push = (name: string) => { if (isCastName(name) && !names.includes(name)) names.push(name); };
  // ① 唯一发现通道：人物设定块 + 可信说话人。
  //    两条子通道判据强度**不同**：
  //    - 说话人由解析器按 `speakerTrusted` **筛过一遍**（`标签：值` 行不可信即降级为叙述），
  //      这里不再用「像不像人名」的启发式二次过滤 —— 否则「灯光师」「小雨」这类含环境字样的
  //      真实角色会被 `environmentOnly` 的子串匹配误杀，只有台词镜写得出、继承镜写不出。
  //    - 人物设定块条目仍走完整 `isCastName`，拦住道具行（`椅子：一把旧木椅`）。
  for (const script of project.scripts) {
    const parsed = parseScript(script.text);
    const speakers = new Set<string>();
    for (const beat of parsed.beats) {
      if (beat.dialogue && (beat.dialogue.kind ?? 'dialogue') === 'dialogue') speakers.add(speakerNameOf(beat.dialogue.speaker));
    }
    for (const name of parsed.cast) {
      if (speakers.has(name)) {
        if (!names.includes(name)) names.push(name);
        continue;
      }
      push(name);
    }
  }
  // ② 叙述句主语只做佐证：已确证姓名或角色泛称，其余一律视为叙述片段噪声。
  const declared = [...names];
  for (const script of project.scripts) {
    const parsed = parseScript(script.text);
    for (const beat of parsed.beats) {
      if (beat.kind !== 'action') continue;
      narrationSubjects(beat.text, (name) => {
        if (declared.includes(name) || roleSpeaker.test(name)) push(name);
      });
    }
  }
  if (castCache.size > 4) castCache.clear();
  castCache.set(text, names);
  return names;
}

/**
 * 姓名位的锚点：静止位动词。⑨ 站位的写法定式是「苏清苒立于画面左侧三分之一」，
 * 这类子句里没有任何 `bodyActions` 里的动作动词 —— 若不单独认，**「凭空多出一个不出声的人站在那儿」
 * 恰好落在盲区里**（那是幻觉名最典型的形态）。
 */
const staticVerbs = /^(?:立于|站在|坐在|位于|身处|处在|蹲在|跪在|靠在|倚在|立在)/u;

/** 由同一份静止位动词表拼出的「姓名 + 静止位动词」前置匹配 —— 表改了这里自动跟随。 */
const nameBeforeStaticVerb = new RegExp(`^([\\u4e00-\\u9fa5]{1,4}?)(?=${staticVerbs.source.slice(1)})`, 'u');

/** 取子句里处在**姓名位**的串：动作动词之前（`苏清苒推门`）或静止位动词之前（`林夏立于…`）。 */
function nameSlotIn(clause: string): string {
  const index = verbIndexIn(clause);
  if (index > 0) {
    const match = subjectLead.exec(clause.slice(0, index).trim());
    if (match) return match[1];
  }
  const still = nameBeforeStaticVerb.exec(clause);
  return still ? still[1] : '';
}

/**
 * 名册之外的姓名检测 —— **AI 侧人名防幻觉**（P3 §4.2 第 7 项）。
 *
 * 判据与本地侧**同源**：本地是「拿名册去文本里找本人」（roster-driven，见 `sceneAnchorOf`），
 * 这里反过来 —— 「把文本里落在**姓名位**的串拿出来对名册」，复用同一套发现机制
 * （`clausesOf` 切子句 → `verbIndexIn` 定位动作动词 → `subjectLead` 取姓名），
 * 所以两侧对「什么算姓名」的理解不会分叉。姓名位只有两个：动作动词之前 / 静止位动词之前。
 *
 * **调用方只对「主体位字段」用它**（⑨站位 / ⑩肢体动作）—— 这两个字段的主语按定义是人，
 * 所以主语位上出现非人名本身就是缺陷。**不要对 ④构图 调用**：构图允许器物作主语
 * （`门框占左前景` / `书桌位于右后景`），拿它去扫会把器物判成幻觉名，属于误杀。
 * ⑦光源 / ⑧氛围 / ⑬音效 天然不含姓名，⑪微表情 只写肌群，都不必扫。
 *
 * 同时这也说明「为什么不做全串扫」：AI 的 ④⑨⑩ 里满是肌群与方位描述（「眉峰下压」「画面左侧」），
 * 全串扫「像姓名」的 2–4 字组合会把它们全判成幻觉名 —— 那是「宁可错杀」的方向，
 * 会让 AI 通路退化成永远走本地。只认姓名位，正对真正有害的那一类：
 * 凭空写出一个不存在的人**走进画面**或**站在画里**。
 *
 * @param text 待检文本（调用方把该镜的主体位字段拼起来）
 * @param cast 名册（`projectCast()`；泛称角色如「记者甲」也在册内）
 * @returns 名册外的姓名（按出现顺序去重）
 */
export function foreignNamesIn(text: string, cast: readonly string[]): string[] {
  const found: string[] = [];
  for (const clause of clausesOf(text)) {
    const name = nameSlotIn(clause);
    if (!name) continue;
    if (bodyParts.test(name) || countOrPartLike.test(name)) continue;
    if (!isCastName(name)) continue;
    if (cast.includes(name) || found.includes(name)) continue;
    found.push(name);
  }
  return found;
}

function shotTexts(episode: Episode, shot: Shot): string[] {
  const texts = shot.beatIds.map((id) => episode.beats.find((beat) => beat.id === id)?.text.trim() ?? '').filter(Boolean);
  return [...texts, ...shot.dialogue.map((item) => item.speaker).filter(Boolean)];
}

/**
 * 本镜的**可信说话人**裸名（⑫ 台词与旁白 / 内心OS 之外的 `kind === 'dialogue'`）。
 * 口径（2026-10-01）：**谁说话就用谁的名字** —— 说话人一律进本镜主体，
 * 不受名册「≤5 字 / 不含字母数字」限制（`评委A` / `投资方代表甲` 这类照样写得出），
 * 因为说话人要承载 ⑩ 肢体动作与 ⑪ 微表情。
 */
export function shotSpeakers(episode: Episode, shot: Shot): string[] {
  const names: string[] = [];
  for (const item of shot.dialogue) {
    if ((item.kind ?? 'dialogue') !== 'dialogue') continue;
    const name = speakerNameOf(item.speaker);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** 在全串里定位名字（允许原稿在说话人里插了空格 / 点号：`评委 A` ⇒ 归一后再找）。 */
function indexInBlob(blob: string, norm: string, name: string): number {
  const direct = blob.indexOf(name);
  return direct >= 0 ? direct : norm.indexOf(name);
}

/**
 * 场次轴线锚（单一来源）：本场次全部主体按**原稿出现顺序**排定，
 * 第一个在画面左、第二个在画面右，整场锁死。
 *
 * 口径（2026-10-01 老大裁定）：**站位左右由上下文的场次设计决定，不能逐镜乱跳，否则越轴穿帮** ——
 * 说话人只保证「名字出现」，不决定左右；同一场次内同一人物永远在同一侧。
 */
function sceneAnchorOf(project: Project, cast: string[], episode: Episode, sceneId: string): string[] {
  const key = `${project.id}|${episode.id}|${sceneId}`;
  const cached = anchorCache.get(key);
  if (cached) return cached;
  const beats = episode.beats.filter((beat) => beat.sceneId === sceneId);
  const parts: string[] = [];
  for (const beat of beats) {
    parts.push(beat.text.trim());
    if (beat.dialogue && (beat.dialogue.kind ?? 'dialogue') === 'dialogue') parts.push(speakerNameOf(beat.dialogue.speaker));
  }
  const blob = parts.filter(Boolean).join('\n');
  const norm = blob.replace(/\s+/gu, '');
  const names: string[] = [];
  for (const name of cast) if (indexInBlob(blob, norm, name) >= 0 && !names.includes(name)) names.push(name);
  for (const beat of beats) {
    if (beat.kind !== 'dialogue' || !beat.dialogue || (beat.dialogue.kind ?? 'dialogue') !== 'dialogue') continue;
    const name = speakerNameOf(beat.dialogue.speaker);
    if (name && !names.includes(name)) names.push(name);
  }
  names.sort((a, b) => indexInBlob(blob, norm, a) - indexInBlob(blob, norm, b));
  if (anchorCache.size > 64) anchorCache.clear();
  anchorCache.set(key, names);
  return names;
}

/**
 * 行首镜头标记（`【接·视线】` / `〔…〕` / `［…］`）。
 * 代词判据必须先剥掉它，否则 `【` 会挡住紧随其后的主语 ——
 * 真稿 `【接·视线】他抬头…` 一类匹配剪辑镜因此被误判为「无人物入画」（实测 7 镜）。
 */
const leadingShotMarker = /^[【〔［][^】〕］]{0,12}[】〕］]\s*/u;

/** 代词起首 = 有隐含主体（`他抬头…` / `两人对望…`），此时继承上镜主体。 */
const pronounLed = /^(?:他|她|他们|她们|两人|二人|双方|彼此|对方)/u;

/** 本镜出现的人物（按本镜文本内的出现顺序）；无人物证据时不臆造主体。 */
function subjectsOf(cast: string[], episode: Episode, shot: Shot, fallback: string[]): string[] {
  const texts = shotTexts(episode, shot);
  const joined = texts.join('\n');
  const norm = joined.replace(/\s+/gu, '');
  const names = cast.filter((name) => indexInBlob(joined, norm, name) >= 0);
  // 谁说话就用谁的名字：可信说话人一律进主体，不受名册判据限制。
  for (const speaker of shotSpeakers(episode, shot)) if (!names.includes(speaker)) names.push(speaker);
  if (names.length) return names.sort((a, b) => indexInBlob(joined, norm, a) - indexInBlob(joined, norm, b));
  // 补位镜（无节拍）与代词镜（他 / 她 / 两人）继承上镜主体；纯环境或声音镜没有人物，不继承。
  if (!texts.length) return fallback;
  const hasPerson = bodyParts.test(joined) || facialActions.test(joined) || pronounLed.test(joined.trim().replace(leadingShotMarker, '').trim());
  return hasPerson ? fallback : [];
}

function startOfBeat(beat: Beat | undefined): BeatCategory {
  return beat ? classifyBeat(beat) : 'dialogue';
}

// ── 子句级证据抽取 ──────────────────────────────────────────────────────────

/** 只从**非台词**节拍取证：台词行只承载台词，不承载舞台指示。 */
function evidenceTexts(episode: Episode, shot: Shot): string[] {
  return shot.beatIds
    .map((id) => episode.beats.find((beat) => beat.id === id))
    .filter((beat): beat is Beat => !!beat && beat.kind === 'action')
    .map((beat) => beat.text.trim())
    .filter(Boolean);
}

function clausesOf(text: string): string[] {
  return text.split(/[，,。；;！？!?\n]+/u).map((clause) => clause.replace(/[（(][^）)]*[）)]/gu, '').trim()).filter(Boolean);
}

function directionOf(clause: string): string {
  for (const [pattern, direction] of bodyActions) if (pattern.test(clause)) return direction;
  return '';
}

/** 是否含身体动作证据（节拍分类与 ⑩ 共用同一张动作表）。 */
function hasBodyAction(text: string): boolean {
  return clausesOf(text).some((clause) => !!directionOf(clause));
}

function stripLead(text: string): string {
  return text.replace(/^[的，,、\s]+/u, '').trim();
}

/** 人物归属：子句内已有的姓名优先，其次代词按上镜主体回填，最后不臆造主体。 */
function resolveSubject(clause: string, subjects: string[], primary: string): { who: string; rest: string } {
  const hit = subjects.find((name) => clause.includes(name));
  if (hit) return { who: hit, rest: stripLead(clause.replace(hit, '')) };
  const pronoun = /^(?:他|她|他们|她们|两人|二人|双方|彼此|对方)/u.exec(clause);
  if (pronoun) {
    const who = subjects.length ? subjects.join('和') : primary;
    return who ? { who, rest: stripLead(clause.slice(pronoun[0].length)) } : { who: '', rest: clause };
  }
  return primary && (bodyParts.test(clause) || facialActions.test(clause)) ? { who: primary, rest: clause } : { who: '', rest: clause };
}

/**
 * ⑩ 肢体动作（方位 / 动线）：原稿动作证据优先；原稿没有动作证据但本镜有人物时，
 * 按剧情档给一条可执行的微动作（`design` 为已选定的强度档文案），不再一律填「无」。
 *
 * **多人分写（2026-10-19）**：同镜两人及以上时，第一人做设计动作，其余人只给承接微动
 * （`ensemble`）—— 原先 `subjects.join('和')` 让两人共用一条文案，等于两个身体做一个动作。
 * 方向短语从括号改为「；动线：…」，避免与原文动词挤在同一句里被读成并列动作。
 */
export function actionFor(texts: string[], subjects: string[], primary: string, design = '', ensemble = ''): string {
  const items: string[] = [];
  for (const text of texts) {
    for (const clause of clausesOf(text)) {
      if (items.length >= 3) break;
      if (facialVerbs.test(clause)) continue;
      if (environmentOnly.test(clause)) continue;
      const direction = directionOf(clause);
      if (!direction) continue;
      const named = subjects.some((name) => clause.includes(name));
      const carried = /^(?:他|她|他们|她们|两人|二人|双方|彼此|对方)/u.test(clause);
      if (!named && !carried && !bodyParts.test(clause)) continue;
      const { who, rest } = resolveSubject(clause, subjects, primary);
      const item = `${who}${rest}；动线：${direction}`;
      if (!items.includes(item)) items.push(item);
    }
  }
  if (!items.length && subjects.length && design) {
    items.push(subjects.map((name, index) => `${name}${index === 0 ? design : ensemble || design}`).join('；'));
  }
  return items.length ? items.join('；') : '无';
}

/**
 * ⑪ 微表情：原稿面部 / 呼吸 / 颤抖证据优先；原稿没有证据但本镜有人物时，按剧情档给设计好的
 * 肌群级微表情，不再一律填「无」。空镜（无人物）仍填「无」。
 *
 * **分人分写（2026-10-19）**：两人同框时第一人取 `design`、其余人取 `second`（换部位的克制反应），
 * 不再合并成「甲和乙眼睑收窄…」—— 那会让两个人做同一组肌群同向动作。
 */
export function performanceFor(texts: string[], subjects: string[], primary: string, design = '', second = ''): string {
  const items: string[] = [];
  for (const text of texts) {
    for (const clause of clausesOf(text)) {
      if (items.length >= 2) break;
      if (!facialVerbs.test(clause) || !facialActions.test(clause)) continue;
      const { who, rest } = resolveSubject(clause, subjects, primary);
      const item = `${who}${rest}`;
      if (!items.includes(item)) items.push(item);
    }
  }
  if (!items.length && subjects.length && design) {
    items.push(subjects.map((name, index) => `${name}：${index === 0 ? design : second || design}`).join('；'));
  }
  return items.length ? items.join('；') : '无';
}

// ── ⑬ 空间底噪（单一来源）：按剧情所处环境派生环境声层 ──────────────────────
//
// 口径（2026-10-01 三次裁定）：⑬ 音效仍以原稿声源证据优先；无证据或证据不含该环境时，
// 按**本镜所处场景的环境**补一层空间底噪（地点 → 环境声，昼夜 → 时段声）。
// 底噪只描述环境声层，不得编造对白、配乐或具体剧情音效；场景无环境线索时仍填「无」。

type AmbienceTopic = 'rain' | 'wind' | 'thunder' | 'snow' | 'indoor' | 'street' | 'crowd' | 'nature' | 'vehicle';

/** 场景标题 → 空间底噪：`[匹配, 主题, 底噪描述]`；表内顺序即优先级（具体地点优先于通用层）。 */
const ambienceCues: [RegExp, AmbienceTopic, string][] = [
  [/医院|病房|诊室|手术|急诊|门诊|输液|护士站|药房/u, 'indoor', '走廊尽头间歇的推车滚轮声与远处电子提示音的持续底噪'],
  [/办公室|会议室|写字楼|公司|工位|档案室|资料室|书库|前台/u, 'indoor', '室内空调低鸣与键盘间歇敲击的持续底噪'],
  [/卧室|客房|客厅|书房|厨房|公寓|宿舍|屋内|房里|家里|沙发/u, 'indoor', '室内安静空气层与窗外远处车流的持续底噪'],
  [/餐厅|饭店|食堂|酒吧|酒馆|咖啡馆|咖啡|茶馆|包间|大排档/u, 'crowd', '杯碟轻碰与低语人声交织的持续底噪'],
  [/片场|摄影棚|影棚|剧组|舞台|后台|化妆间|布景/u, 'indoor', '灯架电流低鸣与场务走动搬运的持续底噪'],
  [/法庭|审讯|羁押|看守所|派出所/u, 'indoor', '空旷室内的高顶回响与远处脚步声的持续底噪'],
  [/教室|学校|校园|教学楼/u, 'crowd', '走廊人群走动与铃声余响的持续底噪'],
  [/酒店|宾馆|旅馆|大堂/u, 'indoor', '大堂空调低鸣与远处电梯到站的提示底噪'],
  [/楼道|楼梯间|电梯|走廊|过道|地下车库|车库/u, 'indoor', '空旷过道里偶发脚步回响与通风口的持续底噪'],
  [/街|马路|路口|广场|巷|天桥|地铁|车站|商场|超市|夜市/u, 'street', '远处车流与人流走动的持续环境声'],
  [/车内|车上|出租车|公交|轿车|卡车|高架|高速|驾驶/u, 'vehicle', '发动机低频运转与路面胎噪的持续底噪'],
  [/工地|厂房|仓库|码头|车间/u, 'indoor', '远处机械低频轰鸣与金属碰撞回响的持续底噪'],
  [/晒谷场|谷场|场院|院坝|院子|村口|村|乡|屯|田埂/u, 'nature', '开阔场地的风声与远处零星人声鸡犬的持续底噪'],
  [/祠堂|庙|佛堂|老宅/u, 'indoor', '空旷厅堂的回响与周围极低的空气底噪'],
  [/树林|田野|河边|湖畔|海边|海滩|山村|野外|营地|山|江边/u, 'nature', '风穿过植被与远处虫鸟交替的持续环境声'],
  [/天台|阳台|屋顶|露台/u, 'wind', '高处风穿过栏杆的持续风声'],
  [/雨|暴雨|雷|梅雨|阴雨/u, 'rain', '雨点持续敲打与屋檐流水的低频底噪'],
  [/雪|风雪/u, 'snow', '风雪穿过缝隙的低鸣与脚下积雪的细碎声'],
  [/大风|夜风|海风|风/u, 'wind', '风穿过缝隙的持续低频底噪'],
];

/** 声源证据 → 环境主题；用于避免底噪与证据重复（原稿已写雨声就不再补雨声底噪）。 */
function ambienceTopicOfSound(label: string): AmbienceTopic | null {
  if (/雷/.test(label)) return 'thunder';
  if (/雨/.test(label)) return 'rain';
  if (/风/.test(label)) return 'wind';
  return null;
}

/** 场次标记：剧本自带的「内 / 外」与昼夜。⑬空间底噪与 ⑦光源 / ⑧氛围 共用，单一来源。 */
type SceneMarker = { indoor: boolean | null; time: 'day' | 'dusk' | 'night' | null };

function sceneMarkerOf(title: string): SceneMarker {
  const indoor = /内/u.test(title) ? true : /外/u.test(title) ? false : null;
  const time = /夜|深夜|凌晨/u.test(title) ? 'night'
    : /傍晚|黄昏|日落|暮|晚/u.test(title) ? 'dusk'
      : /日|白天|清晨|早|午|晨/u.test(title) ? 'day'
        : null;
  return { indoor, time };
}

/**
 * 通用底噪：具体地点未命中时，由剧本自带的「内 / 外」与昼夜标记派生 —— 这两个标记写在场次标题里，
 * 属剧本自身信息，不是臆测。`日.内 办公室` 这类标准场次头因此不会漏掉环境层。
 */
function genericAmbience(title: string, covered: Set<AmbienceTopic>): string {
  const { indoor, time } = sceneMarkerOf(title);
  const night = time === 'night' || time === 'dusk';
  if (indoor === true) {
    if (night) return '室内夜间环境底噪：灯具电流低鸣与窗外稀疏夜声';
    return covered.has('rain') ? '室内安静空气层与设备低频运转的持续底噪' : '室内环境底噪：空调或风扇低鸣与室外远处人声';
  }
  if (indoor === false) return night ? '室外夜间环境底噪：夜风与远处稀疏虫鸣车声' : '室外日间环境底噪：风穿过开阔空间与远处人声车声';
  if (night) return '夜间环境底噪：远处稀疏车声与虫鸣';
  if (time === 'day') return '日间环境底噪：远处零散人声与车流';
  return '';
}

/** 场景标题派生的空间底噪；无环境线索或主题已被证据覆盖时返回空串。 */
function ambienceFor(sceneTitle: string, sounds: string[]): string {
  const title = sceneTitle.trim();
  if (!title) return '';
  const covered = new Set(sounds.map(ambienceTopicOfSound).filter((topic): topic is AmbienceTopic => !!topic));
  for (const [pattern, topic, text] of ambienceCues) {
    if (!pattern.test(title)) continue;
    if (covered.has(topic)) continue;
    return text;
  }
  return genericAmbience(title, covered);
}

/**
 * ⑬ 音效：原稿可观察声源证据优先，再按本镜所处场景的环境补空间底噪。
 * 证据与底噪都没有时填「无」（场景未标注环境，不凭空造声）。
 */
export function soundFor(texts: string[], sceneTitle = ''): string {
  const items: string[] = [];
  for (const text of texts) {
    for (const clause of clausesOf(text)) {
      for (const [pattern, label] of soundSources) {
        if (!pattern.test(clause)) continue;
        if (!items.includes(label)) items.push(label);
        break;
      }
    }
  }
  const ambience = ambienceFor(sceneTitle, items);
  if (ambience) items.push(ambience);
  return items.length ? items.join('；') : '无';
}

// ── 情绪档与微表情/微动作设计（单一来源） ─────────────────────────────────────
//
// 口径：⑩⑪ 先在原稿取证；**原稿没有可观察证据时，按剧情语义设计**，不再一律填「无」。
// 剧情语义 = 本镜台词内容 + 叙述 + 节拍类型；强度档 = 人物弧光（叙事位置 + 情绪镜密度）。
// 设计产物必须是肌群级或肢体级可执行动作，禁止「紧张地看着」这类情绪形容词。

export type EmotionKey = 'grieving' | 'hostile' | 'startled' | 'pleading' | 'scheming' | 'resolved' | 'weary' | 'warm' | 'suppressed' | 'neutral';

/** 情绪档识别表：命中顺序即优先级（越靠前越是强情绪）。 */
const emotionCues: [EmotionKey, RegExp][] = [
  ['grieving', /哭|泪|哽咽|抽泣|呜咽|红着眼|红了眼|鼻子一酸|忍不住|难受|疼|痛|悲|颤|抖|哽/u],
  ['hostile', /怒|恨|咬牙|瞪|吼|骂|滚|打死|废物|凭什么|冷笑|拍桌|摔|撕|扯|质问|顶撞/u],
  ['startled', /惊|愣|怔|懵|呆|一颤|猛地|突然|没想到|竟然|居然|怎么会|不可能/u],
  ['pleading', /求|拜托|帮帮|可怜|别走|不要走|原谅|对不住|对不起|抱歉|我错了|听我说/u],
  ['scheming', /试探|打量|琢磨|算计|假装|装的|故作|陪笑|恭维|套话|话里有话|递话/u],
  ['resolved', /决定|认了|豁出去|拼了|一定|必须|来吧|不回头|放开演|我担着|算我的|走一步/u],
  ['weary', /累|疲惫|倦|麻木|算了|随你|无所谓|叹|没力气|懒得/u],
  ['warm', /笑|谢|辛苦|照顾|陪着|牵挂|惦记|放心|妈|家|晚饭|多穿/u],
  ['suppressed', /沉默|没说|不出声|说不出|憋|压着|藏|忍|不动声色|平静|淡淡|轻声|低声/u],
];

/**
 * 情绪档 → 设计好的微表情（面部肌群 / 呼吸）与微动作（带方位动线的肢体动作）。
 * 每档三强度：0 = 建置期克制档，1 = 中段常规档，2 = 末段或高压镜释放档。
 *
 * `second` = **同镜第二人**的克制侧反应（2026-10-19 新增）。
 * 原实现把两人合并成一句（`subjects.join('和')` + 同一条文案），产出的是
 * 「甲和乙眼睑收窄，视线锁死一点不动」—— 两个人做同一组肌群同向动作，
 * 等于一张脸演两个人，是「僵」最刺眼的一种。`second` 刻意**换部位**（呼吸 / 指尖 / 喉结 /
 * 重心 / 视线落点），与第一人的面部肌群错开，形成一强一静。
 */
type EmotionDesign = { face: [string, string, string]; body: [string, string, string]; second: [string, string, string] };

const emotionDesigns: Record<EmotionKey, EmotionDesign> = {
  suppressed: {
    face: ['眉尾压平，上眼睑下落盖住瞳孔上缘，嘴唇抿紧向内收', '眉尾向两侧压平拉长，嘴唇抿成一条直线，下颌轻微收拢', '眉心挤出一条浅竖纹，嘴唇抿住下压，喉结滚动一次'],
    body: ['重心压在后脚掌，双肩向内收拢', '重心压在后脚掌，双肩向内收拢，手指在身侧收紧半寸', '肩线同时向内压低，双手在身前交握后收紧'],
    second: ['视线落在对方衣领处不动，呼吸放浅', '视线落在对方手上，指尖在身侧收拢再松开', '喉结滚动一次，视线移向门口后收回'],
  },
  startled: {
    face: ['眉尾上抬，上眼睑抬高露出上缘眼白，嘴微张后合上', '眉毛整体上抬，上眼睑抬高露出眼白，嘴微张停住半拍', '眉毛窜高，上眼睑完全抬高，嘴张开后僵住，呼吸停在半口气上'],
    body: ['重心向后移半个脚掌', '重心向后移半个脚掌，上身后仰一寸', '重心向后移半个脚掌，上身后仰一寸，一侧手臂抬起挡在胸前'],
    second: ['呼吸停半拍后放浅，肩线向上提半寸', '手指在身侧张开，视线先移向声源方向', '肩线向上提一寸，重心向后落半脚掌，视线偏开对方'],
  },
  hostile: {
    face: ['眉头向中间下压，视线锁定对方眼睛不动', '眉头向中间下压挤出一条短竖纹，鼻翼向外扩张一次', '眉头下压挤成竖纹，鼻翼扩张，下颌前送，咬肌鼓起'],
    body: ['肩线抬高，一侧手肘向外撑开', '肩线抬高，一侧手肘向外撑开，前臂绷紧压向身体中线', '肩线抬高，上身前压，手指收拢握紧停在身侧中线'],
    second: ['下颌横向错开半寸，视线不落在对方脸上', '胸口起伏加快一次，手指在桌面上收拢', '肩线压低，重心向前压半寸，视线从对方手上移到脸上'],
  },
  grieving: {
    face: ['上眼睑下垂，视线落在下方一点不动', '上眼睑下垂，下睫毛处聚起一层薄泪膜，嘴角向下牵动一次', '上眼睑下垂，泪膜在下眼睑边缘挂住不掉，嘴角向下牵着，鼻孔微张'],
    body: ['肩膀塌下，双手垂在身侧', '肩膀塌下半寸，头颈向前低倾，双手在身前交握收紧', '肩膀塌下半寸，上身向前折低，双手撑在膝上，指节压到发白'],
    second: ['视线落在地面一点，呼吸放轻', '指尖按住下眼睑，鼻翼收放一次', '背向对方偏开十五度，肩线向下沉半寸'],
  },
  pleading: {
    face: ['眉头内侧向上提起，眼睑放松', '眉头内侧向上提起，眼睑放松，嘴角向后下方拉开', '眉头内侧向上提起，嘴角向后下方拉开，喉结滚动一次，视线不离开对方'],
    body: ['上身前倾一寸', '上身前倾一寸，双手停在身前中线位置', '上身前倾一寸，双手向前伸出停在对方身前，手指张开'],
    second: ['视线停在对方手边，喉结滚动一次', '双手在身前合拢半寸，视线跟随对方', '膝盖向前送出半寸，视线仰起停在对方眼睛'],
  },
  scheming: {
    face: ['视线从对方眼睛移向嘴角再回正', '视线从对方眼睛移向嘴角再回正，单侧唇角上提而眼轮匝肌不动', '视线在对方眼睛与嘴角间来回一次，单侧唇角上提且眼轮匝肌不动，下巴轻微偏转'],
    body: ['上身保持不动', '上身保持不动，一侧手指在身侧轻点一次', '上身保持不动，一侧手指在身侧轻点两次，脚尖转向出口方向'],
    second: ['视线扫过对方手部，呼吸放缓', '指尖在身侧轻点一次，视线移向对方身后', '单侧唇角上提一瞬即回，视线落在对方鞋尖'],
  },
  resolved: {
    face: ['眼睑收窄，视线落定在对手面部一点', '眼睑收窄，视线落定不动，咬肌轻微鼓起', '眼睑收窄，视线锁死一点不动，咬肌鼓起，下颌前送半寸'],
    body: ['重心前移压向前脚掌', '重心前移压向前脚掌，脊背立直', '重心前移压向前脚掌，脊背立直，双手在身侧握紧，动线一次性走完'],
    second: ['视线平视前方不移动，呼吸压深一次', '下颌收拢，双手背在身后握紧', '肩线立起，重心前移半寸，视线越过对方'],
  },
  weary: {
    face: ['眼睑半垂，眉心放松', '眼睑半垂，眉心放松后抽动一下，呼吸变浅', '眼睑半垂，眉心抽动一下，呼吸变浅变长，嘴角向下松开'],
    body: ['肩线松垮下坠', '肩线松垮下坠，重心在双脚间小幅晃动', '肩线松垮下坠，上身歪向一侧，单手撑住近处的支撑面'],
    second: ['上眼睑下落半毫米，呼吸放长', '手指松开垂落，视线移向窗外', '上身向一侧偏开一寸，视线落在地面不动'],
  },
  warm: {
    face: ['眼角细纹舒展，嘴角自然上提', '眼轮匝肌收缩使眼角出现细纹，嘴角上提，眉尾放松上抬', '眼轮匝肌收缩挤出眼角细纹，嘴角上提，眉尾放松上抬，呼吸放缓一次'],
    body: ['肩线放松下沉', '肩线放松下沉，上身向对方一侧轻转十五度', '肩线放松下沉，上身向对方轻转，重心向对方方向挪半步'],
    second: ['眼角松开，视线落在对方手上', '嘴角上提一瞬，呼吸放缓一次', '身体向对方偏转十五度，视线抬起停在对方眼睛'],
  },
  /**
   * 中性档（2026-10-19 重写）：原六条是「重心居中，双肩平齐，双手停在身体两侧」这类**静止罗列**，
   * 视频模型没有可演绎的运动，成片就是一张定格。对白镜多数落在此档，是全片「僵」的主要产地。
   * 现改为**有动有停的小动作**：换支撑、松肩、视线换落点 —— 幅度仍克制，但有起点和停点。
   */
  neutral: {
    face: ['眼睑开合一次，视线落在对方手上再抬起', '眉尾松开半毫米，视线在对方眼睛与手之间换一次落点', '视线从对方手上移到脸上，鼻翼随吸气收放一次，唇角松开半寸'],
    body: ['重心在后脚跟与前脚掌之间换一次支撑', '肩线松开半寸，一只手的手指在身侧依次收拢再松开', '上身向后靠半寸又停住，头颈随视线偏转十五度'],
    second: ['视线移向门的方向再收回，呼吸平稳', '手指在身侧松开，肩线落下半寸', '头颈偏转十五度，视线落在对方手边，眨一次眼'],
  },
};

/**
 * 多人镜里非第一主体的承接姿态（无证据可设计时使用）。
 *
 * 表演常识：对话镜里一个人动、另一个人稳住 —— 两人同时发力反而假。
 * 因此第二人及以后**不做设计动作**，只给出一个可演的承接微动，避免「两人一起做同一件事」。
 */
const ensembleHolds = ['保持上镜承接姿态，肩线随呼吸起伏一次', '保持上镜承接姿态，重心在两脚间换一次支撑'];

/** 情绪档识别：台词内容与叙述语义优先，无线索时按节拍类型兜底。 */
export function emotionKeyOf(category: BeatCategory, texts: string[]): EmotionKey {
  const joined = texts.join('\n');
  for (const [key, cue] of emotionCues) if (cue.test(joined)) return key;
  if (category === 'action') return 'resolved';
  if (category === 'emotion') return 'suppressed';
  if (category === 'establish') return 'neutral';
  return 'neutral';
}

export type ArcStage = 'setup' | 'rising' | 'payoff';

const arcLevel: Record<ArcStage, number> = { setup: 0, rising: 1, payoff: 2 };

const arcCache = new Map<string, Map<string, ArcStage>>();

/**
 * 跨集人物弧光：叙事位置（集号在全本的比例）+ 该人物在本集参与镜中的强情绪镜密度。
 * 建置期取克制档、中段取常规档、末段或高压镜取释放档 —— 只决定微表情/微动作的设计强度，
 * 不额外编造剧情；同一项目同一集的结果被缓存，保证生成与写入边界口径恒等且不重复计算。
 */
function arcStages(project: Project, episode: Episode): Map<string, ArcStage> {
  const cacheKey = `${project.id}:${episode.id}`;
  const cached = arcCache.get(cacheKey);
  if (cached) return cached;
  const cast = projectCast(project);
  const owned = new Map<string, number>();
  const stressed = new Map<string, number>();
  const strong: EmotionKey[] = ['grieving', 'hostile', 'startled', 'pleading'];
  for (const segment of episode.segments) {
    for (const shot of segment.shots) {
      const texts = shotTexts(episode, shot);
      const joined = texts.join('\n');
      if (!joined) continue;
      const category = startOfBeat(episode.beats.find((item) => shot.beatIds.includes(item.id)));
      const emotion = emotionKeyOf(category, texts);
      for (const name of cast) {
        if (!joined.includes(name)) continue;
        owned.set(name, (owned.get(name) ?? 0) + 1);
        if (strong.includes(emotion)) stressed.set(name, (stressed.get(name) ?? 0) + 1);
      }
    }
  }
  const total = Math.max(1, project.episodes.length);
  const position = (episode.index || 1) / total;
  const stages = new Map<string, ArcStage>();
  for (const [name, count] of owned) {
    const density = count ? (stressed.get(name) ?? 0) / count : 0;
    stages.set(name, position <= 1 / 3 && density < 0.5 ? 'setup' : position >= 2 / 3 || density >= 0.6 ? 'payoff' : 'rising');
  }
  if (arcCache.size > 8) arcCache.clear();
  arcCache.set(cacheKey, stages);
  return stages;
}

/** 本镜主体的设计强度档；主体不在弧光表内（补位镜）时按中段常规档。 */
export function arcStageOf(project: Project, episode: Episode, name: string): ArcStage {
  return arcStages(project, episode).get(name) ?? 'rising';
}

export function designLevelOf(project: Project, episode: Episode, name: string): number {
  return arcLevel[arcStageOf(project, episode, name)];
}

// ── 站位与构图（同一 staging 派生，结构上不可能自相矛盾） ──────────────────────

type Staging = { subjects: string[]; side: '左' | '右' | '中' | ''; blocking: string; anchor: string };

/**
 * ⑨ 站位：左右由**本场次轴线锚**（`anchor` = 该场人物按原稿出场次序）锁定，
 * 逐镜不跳 —— 同一场次内同一人物永远在同一侧，避免越轴穿帮。
 *
 * 口径（2026-10-01 老大裁定）：**不是谁说话谁站左**，而是按上下文设计好的场次站位；
 * 说话人只保证名字出现（见 `shotSpeakers`），不决定左右。
 * 实现要点：`sideOf` 是「（场次锚 + 人物名）→ 侧位」的**纯函数**，与「本镜还有谁入画」无关，
 * 因此任何镜头组合下同一人物的侧位恒等（旧实现按本镜前两名取左右，第三人一入画就翻转）。
 */
export function stagingFor(subjects: string[], inherited: string, anchor: string[] = []): Staging {
  // 无场次锚（无上下文，如单测直调）时退回本镜出场次序，保证首名仍恒在画面左。
  const axis = anchor.length ? anchor : subjects;
  const sideOf = (name: string): '左' | '右' => {
    const index = axis.indexOf(name);
    if (index >= 0) return index % 2 === 0 ? '左' : '右';
    return subjects.indexOf(name) % 2 === 0 ? '左' : '右';
  };
  const ordered = [...subjects].sort((a, b) => {
    const ra = axis.indexOf(a);
    const rb = axis.indexOf(b);
    if (ra >= 0 && rb >= 0) return ra - rb;
    if (ra >= 0) return -1;
    if (rb >= 0) return 1;
    return subjects.indexOf(a) - subjects.indexOf(b);
  });
  if (!ordered.length) {
    return { subjects, side: '', anchor: '画面无人物主体，以空间层次为构图主体', blocking: '本镜无人物入画，空间关系占据画面，机位保持在场次轴线一侧' };
  }
  const left = ordered.filter((name) => sideOf(name) === '左');
  const right = ordered.filter((name) => sideOf(name) === '右');
  if (left.length && right.length) {
    const pair = left.length === 1 && right.length === 1;
    const carry = inherited.includes(`左侧${left[0]}`) ? '，承接上镜轴线不变' : '';
    return {
      subjects: ordered, side: '左', anchor: '主体分列画面左右三分之一',
      blocking: `左侧${left.join('与')}与右侧${right.join('与')}分列画面左右三分之一，${pair ? '两人正面相对，视线在画面中部相接；轴线为两人连线' : '两侧人物正面相对，视线在画面中部相接；轴线为两侧连线'}，锁定在画面水平中轴${carry}`,
    };
  }
  // 同一侧（场次轴线把这一组人都排在左或右）：仍逐个写出姓名与朝向，位置不因他人在场而改变。
  const group = left.length ? left : right;
  const side: '左' | '右' = left.length ? '左' : '右';
  const opposite = side === '左' ? '右' : '左';
  const carry = inherited.startsWith(group[0]) ? '，延续上镜轴线' : '';
  return {
    subjects: ordered, side, anchor: `主体位于画面${side}三分之一`,
    blocking: `${group.join('与')}位于画面${side}三分之一，身体朝向画面${opposite}侧，视线落在画面${opposite}三分之一${carry}`,
  };
}

/** ④ 构图：视线焦点 + 景别景深 + 留白 + 框中框 / 纵深；主体位置与 ⑨ 站位同源。 */
export function compositionFor(staging: Staging, category: BeatCategory, scale: string): string {  const pair = staging.subjects.length >= 2;
  const focus = pair ? '视线焦点落在两人视线相接的画面中部'
    : staging.subjects.length === 1 ? '视线焦点落在主体面部'
      : '视线焦点落在空间纵深方向的消失点';
  const depth = staging.subjects.length ? depthByScale[scale] ?? '中景主体实焦，前后景适度虚化' : spaceDepthByScale[scale] ?? '中景实焦，前后景适度虚化';
  const space = pair ? '两人之间保留视线空间，画面两侧各留出移动余量'
    : staging.subjects.length === 1 ? '主体对侧留出负空间与动线余量'
      : '画面四边保留完整空间边界';
  const frame = staging.subjects.length === 0 ? '以门窗或墙体线条构成框中框，引导视线进入纵深'
    : category === 'dialogue' ? '以前景肩背或门框压住画面一侧形成框中框'
      : category === 'action' ? '利用前后景层次把动势压在画面中部，纵深方向保留交锋空间'
        : category === 'establish' ? '以门窗或墙体线条构成框中框，引导视线进入纵深'
          : '背景压虚，人物轮廓与留白形成负空间';
  return `主体位置：${staging.anchor}；${focus}；${depth}；${space}；${frame}`;
}

/**
 * 从 `stagingFor` 写出的文案里解析「姓名 → 侧位」。**与 `stagingFor` 互为逆函数的单一来源**：
 * 改动 `stagingFor` 的三种写法必须同步这里，反之亦然。生成层、审计层与边界校正共用。
 *
 * - `左侧A与B与右侧C分列…` → A/B 左、C 右
 * - `A与B位于画面左三分之一…` → A/B 左
 * - 识别不到任何主体（空镜、人工自创写法）→ 返回空数组，调用方据此跳过，**宁可漏报不误报**。
 * - 只认「位于画面 X 三分之一」这类**位置**表述：`身体朝向画面右侧` 属朝向，不参与判定。
 */
export function sidesIn(text: string): [string, string][] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('无人物入画')) return [];
  const split = /左侧(.+?)与右侧(.+?)分列/u.exec(trimmed);
  if (split) {
    return [...split[1].split('与').map((name) => [name, '左'] as [string, string]), ...split[2].split('与').map((name) => [name, '右'] as [string, string])];
  }
  const pairs: [string, string][] = [];
  for (const match of trimmed.matchAll(/([\u4e00-\u9fa5与]+?)位于画面([左右中])三分之一/gu)) {
    for (const name of match[1].split('与')) pairs.push([name, match[2]]);
  }
  return pairs;
}

/**
 * ④ 构图与 ⑨ 站位是否互相矛盾（主体被写到相反一侧）。
 * 判定保守：只在两侧都给出**唯一且相反**的主体位置时成立；双人、空镜、人工自创写法一律不判矛盾。
 *
 * 注意：站位文案里同时含「位于画面左三分之一」与「身体朝向画面右侧」，所以必须用位置解析
 * （`sidesIn`）而不是关键词包含 —— 后者会因两侧都出现而永远判不出矛盾。
 */
export function compositionContradictsStaging(composition: string, blocking: string): boolean {
  const sideOf = (text: string): '' | '左' | '右' | '中' => {
    const sides = new Set(sidesIn(text).map(([, side]) => side));
    return sides.size === 1 ? ([...sides][0] as '左' | '右' | '中') : '';
  };
  const staged = sideOf(blocking);
  const framed = sideOf(composition);
  if (!staged || !framed || staged === '中' || framed === '中') return false;
  return staged !== framed;
}

// ── 场景锚点 ────────────────────────────────────────────────────────────────

function analysisFor(project: Project, segment: Segment, analysisByImage: Map<string, ImageAnalysis>): ImageAnalysis | undefined {
  const images = segment.imageIds.map((id) => project.assets.find((image) => image.id === id)).filter((image): image is NonNullable<typeof image> => !!image);
  const ordered = [...images.filter((image) => image.kind === 'scene'), ...images.filter((image) => image.kind !== 'scene')];
  for (const image of ordered) {
    const analysis = analysisByImage.get(image.id) ?? image.analysis;
    if (analysis) return analysis;
  }
  return undefined;
}

/**
 * ⑦ 光源：有参考图分析时按分析结果；没有参考图时由**本场景标题**的「内 / 外 + 昼夜」派生
 * （剧本自带信息，不是臆测），不再全片同一句常量。
 */
function lightFor(analysis: ImageAnalysis | undefined, sceneTitle = ''): string {
  if (analysis) {
    const direction = { top: '顶部来光', left: '左侧来光', right: '右侧来光', bottom: '底部反光', flat: '均匀散射光' }[analysis.lightDirection];
    const temperature = { warm: '暖色温', cool: '冷色温', neutral: '中性色温' }[analysis.temperature];
    const level = analysis.brightness > 0.62 ? '高照度' : analysis.brightness > 0.38 ? '中等照度' : '低照度';
    return `${direction}，${temperature}，${level}`;
  }
  const { indoor, time } = sceneMarkerOf(sceneTitle);
  if (time === 'night') {
    if (indoor === true) return '夜间室内：灯具顶光与侧光并用，暖冷混合色温，低照度，暗部靠环境补光';
    if (indoor === false) return '夜间外景：实用光源为主，冷色温低照度，暗部保留轮廓光';
    return '夜间：实用光源主导，冷色温低照度，暗部保留轮廓光';
  }
  if (time === 'dusk') return '黄昏自然光为主：低位侧光，低色温暖调，照度渐低，明暗过渡长';
  if (time === 'day') {
    if (indoor === true) return '日间室内：窗外侧光为主，中性偏冷色温，中等照度，墙面反射补光';
    if (indoor === false) return '日间外景：露天顶光为主，色温偏高，高照度，阴影边界清晰';
    return '日间：自然散射光，中性色温，中等照度';
  }
  if (indoor === true) return '室内环境光为主，中性色温，中等照度';
  if (indoor === false) return '室外自然光为主，中性色温，中等照度';
  return '自然散射光，中性色温，中等照度';
}

/** ⑧ 氛围：与 ⑦ 光源同一套场次标记派生，保证两者对同一场次的明暗口径一致。 */
function atmosphereFor(analysis: ImageAnalysis | undefined, sceneTitle = ''): string {
  if (analysis) {
    const temperature = { warm: '暖调', cool: '冷调', neutral: '中性调' }[analysis.temperature];
    const mood = analysis.saturation > 0.45 ? '色彩饱满' : analysis.saturation > 0.25 ? '色彩克制' : '低饱和';
    const space = analysis.indoor === 'indoor' ? '室内封闭' : analysis.indoor === 'outdoor' ? '室外开阔' : '空间层次待定';
    return `${temperature}${mood}，${space}`;
  }
  const { indoor, time } = sceneMarkerOf(sceneTitle);
  if (time === 'night') {
    if (indoor === true) return '低照度冷调，局部光源区亮，室内封闭，暗部占比大';
    if (indoor === false) return '低照度冷调，点状光源，纵深压暗，空气通透';
    return '低照度冷调，光比偏大，暗部占据画面主体';
  }
  if (time === 'dusk') return '暖调为主，明暗过渡柔和，空气中带薄暮感';
  if (time === 'day') {
    if (indoor === true) return '中性调，色彩克制，室内封闭，光线均匀';
    if (indoor === false) return '中性偏暖调，色彩通透，室外开阔，光比清晰';
    return '中性调，色彩通透，空间开阔';
  }
  if (indoor === true) return '中性调，空间层次紧凑，室内封闭';
  if (indoor === false) return '中性调，空间开阔，空气通透';
  return '环境光均匀，情绪平稳';
}

// ── 导演意图 ────────────────────────────────────────────────────────────────

function shortClause(text: string, max = 12): string {
  const clause = text.split(/[，,。；;！？!?\n]/u).map((item) => item.trim()).filter(Boolean)[0] ?? text;
  const chars = [...clause];
  return chars.length > max ? chars.slice(0, max).join('') : clause;
}

/** 导演意图由原剧本节拍自动提炼，正文生成字段以此为叙事目标。 */
export function purposeFor(category: BeatCategory, beat: Beat | undefined, nextCategory: BeatCategory): string {
  const text = beat?.text.trim();
  if (text) {
    const short = shortClause(text);
    if (category === 'action') return `让观众看清${short}的起势与结果`;
    if (category === 'emotion') return `让观众捕捉${short}中的情绪变化`;
    if (category === 'dialogue') return `让观众明确台词信息并关注人物反应`;
    return `让观众建立${short}的空间与关系`;
  }
  return `承接本段${category === 'action' ? '动作' : category === 'emotion' ? '情绪' : category === 'dialogue' ? '对话' : '空间'}信息，并为下一镜${nextCategory === 'action' ? '动作' : nextCategory === 'emotion' ? '情绪' : '叙事'}做准备`;
}

// ── 逐镜字段（生成与写入边界共用同一函数，保证两处口径恒等） ─────────────────────

export type ShotEvidence = { composition: string; blocking: string; action: string; performance: string; sound: string; subjects: string[] };

type ShotContext = { cast: string[]; subjects: string[]; blocking: string };

/** 重建某一镜之前的连续性状态（站位逐镜承接），使边界校正与生成结果逐字一致。 */
function contextBefore(project: Project, episode: Episode, target: Shot): ShotContext {
  const cast = projectCast(project);
  let subjects: string[] = [];
  let blocking = '';
  for (const segment of episode.segments) {
    for (const shot of segment.shots) {
      if (shot === target || shot.id === target.id) return { cast, subjects, blocking };
      const names = subjectsOf(cast, episode, shot, subjects);
      const beat = episode.beats.find((item) => shot.beatIds.includes(item.id));
      blocking = stagingFor(names, blocking, sceneAnchorOf(project, cast, episode, beat?.sceneId ?? segment.sceneId)).blocking;
      subjects = names;
    }
  }
  return { cast, subjects, blocking };
}

/**
 * 段内表演相位（2026-10-19）：同一情绪档在连续镜之间**不得复用同一条文案**。
 *
 * 判据只用 `shot.id` 的数字部分，因此 `audit` / `store` 回填 / 批量生成三处调用得到同一个值 ——
 * 不需要额外传参，也就不会出现「生成用变体 2、边界校验用变体 0」的不一致。
 * 相邻镜编号连续，取模后必然相邻不同。
 *
 * 相位同时承担**段内起伏**：0 = 基准档、1 = 升一档、2 = 降一档。
 * 它是弧光基准档之上的表演微调，不改变 `designLevelOf` 的弧光判据本身
 * （基准档仍由叙事位置与强情绪密度决定）。
 */
function designPhaseOf(shotId: string): 1 | -1 | 0 {
  const number = Number(/(\d+)/u.exec(shotId)?.[1] ?? '0');
  return ([0, 1, -1] as const)[number % 3];
}

/** 证据型字段正本：④构图 ⑨站位 ⑩肢体动作 ⑪微表情 ⑬音效。 */
export function sourceFieldsForShot(project: Project, episode: Episode, shot: Shot): ShotEvidence {
  const { cast, subjects, blocking } = contextBefore(project, episode, shot);
  const names = subjectsOf(cast, episode, shot, subjects);
  const primary = names[0] ?? '';
  const texts = evidenceTexts(episode, shot);
  const beat = episode.beats.find((item) => shot.beatIds.includes(item.id));
  // 空间底噪取本镜所属场景标题（地点 / 昼夜 / 天气）；节拍缺场次时退回所在段。
  const sceneId = beat?.sceneId ?? episode.segments.find((segment) => segment.shots.some((item) => item.id === shot.id))?.sceneId;
  const sceneTitle = episode.scenes.find((scene) => scene.id === sceneId)?.title ?? '';
  const category = startOfBeat(beat);
  // ⑨ 站位的左右由本场次轴线锚锁定，逐镜不跳（说话人只进主体、不决定左右）。
  const staging = stagingFor(names, blocking, sceneAnchorOf(project, cast, episode, sceneId ?? ''));
  // ③ 档位随入画人数校正；④ 构图的景深取同一个 grade，③ 与 ④ 因此结构同源。
  const grade = gradeForShot(category, staging.subjects.length);
  // 剧情档：台词 + 叙述 + 节拍类型定情绪，人物弧光定强度；原稿有证据时以证据为准。
  const emotion = emotionKeyOf(category, shotTexts(episode, shot));
  const baseLevel = primary ? designLevelOf(project, episode, primary) : 1;
  // 弧光基准档 ±1 的段内相位：连续镜不复用同一句，同时形成 起势 → 升级 → 回落。
  const level = Math.max(0, Math.min(2, baseLevel + designPhaseOf(shot.id)));
  const design = emotionDesigns[emotion];
  return {
    composition: compositionFor(staging, category, grade.scale),
    blocking: staging.blocking,
    // 多人镜：第一人做设计动作，其余人只承接；⑪ 的第二人换部位（见 `EmotionDesign.second`）。
    action: actionFor(texts, names, primary, design.body[level], ensembleHolds[level % ensembleHolds.length]),
    performance: performanceFor(texts, names, primary, design.face[level], design.second[level]),
    sound: soundFor(texts, sceneTitle),
    subjects: staging.subjects,
  };
}

/**
 * 规则导演：为整集逐段生成 10 条可生成字段（③④⑤⑥⑦⑧⑨⑩⑪⑬⑭）。
 * 证据型字段与写入边界共用 sourceFieldsForShot；衔接按**镜头内容证据选型**并过滤禁词。
 * 确定性实现，可重复可单测。
 */
export function generateEpisodeDrafts(project: Project, episode: Episode, analysisByImage: Map<string, ImageAnalysis> = new Map()): Map<string, ShotDraft[]> {
  const result = new Map<string, ShotDraft[]>();
  episode.segments.forEach((segment, segmentIndex) => {
    const analysis = analysisFor(project, segment, analysisByImage);
    // 无参考图时，⑦光源 / ⑧氛围 由本段所属场景的「内 / 外 + 昼夜」标记派生。
    const sceneTitle = episode.scenes.find((scene) => scene.id === segment.sceneId)?.title ?? '';
    const light = lightFor(analysis, sceneTitle);
    const atmosphere = atmosphereFor(analysis, sceneTitle);
    // 一段内先把逐镜证据算好，供衔接选型同时看「本镜」与「下一镜」。
    const evidences = segment.shots.map((shot) => sourceFieldsForShot(project, episode, shot));
    // 时长与分镜规划共用同一把尺子：段内各镜之和 = 15 秒，单镜 ≤ 12 秒。
    const durations = allocateShotDurations(segment.shots);
    const drafts: ShotDraft[] = segment.shots.map((shot, shotIndex) => {
      const beat = episode.beats.find((item) => shot.beatIds.includes(item.id));
      const category = startOfBeat(beat);
      const nextShot = segment.shots[shotIndex + 1];
      const nextBeat = nextShot ? episode.beats.find((item) => nextShot.beatIds.includes(item.id)) : undefined;
      const nextSegment = episode.segments[segmentIndex + 1];
      const nextCategory = nextShot ? startOfBeat(nextBeat) : nextSegment ? startOfBeat(episode.beats.find((item) => nextSegment.beatIds.includes(item.id))) : category;
      const evidence = evidences[shotIndex];
      const nextEvidence = evidences[shotIndex + 1];
      // ⑭ 衔接：段内按证据选型；段末分「本集收束 / 换场次重设轴线 / 同场次延续」三种，不再一律写「交棒下一段」。
      const transition = nextShot
        ? sanitizeTransition(pickTransition(transitionContextOf(shot, evidence, nextEvidence, nextShot), segmentIndex + shotIndex + 1))
        : !nextSegment
          ? closingTransition
          : nextSegment.sceneId !== segment.sceneId
            ? sceneChangeTransition
            : carryTransition(nextCategory);
      const purpose = purposeFor(category, beat, nextCategory);
      // ③⑤⑥ 与 ④ 构图共用 gradeForShot：两处取同一档位单元，不可能各说各话。
      const grade = gradeForShot(category, evidence.subjects.length);
      const fields: Partial<Record<EditableShotKey, string>> = {
        scale: grade.scale, composition: evidence.composition, lens: grade.lens, movement: grade.movement,
        light, atmosphere, blocking: evidence.blocking,
        action: evidence.action, performance: evidence.performance, sound: evidence.sound,
        transition,
      };
      return { shotId: shot.id, purpose, duration: durations[shotIndex], fields, source: 'local' as const };
    });
    result.set(segment.id, drafts);
  });
  return result;
}

export function generatedFieldCount(drafts: ShotDraft[]): number {
  return drafts.reduce((sum, draft) => sum + generatedKeys.filter((key) => !!draft.fields[key]?.trim()).length, 0);
}
