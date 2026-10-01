import { type Beat, type Episode, type ImageAnalysis, type Project, type Segment, type Shot } from '../../core/model';
import { briefHeadings, labelOf, parseScript } from '../../core/parser';
import { generatedKeys, type EditableShotKey } from './skeleton';
import { transitionForbiddenPattern } from './validator';

export type BeatCategory = 'action' | 'dialogue' | 'emotion' | 'establish';

/** 生成通道的单镜草稿：只承载 10 条可生成字段。 */
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

/** 镜头模板：动作→中近景·35mm·跟拍；对话→过肩·50mm·静止；情绪→特写·85mm；建立→大全景·24mm。 */
export const shotTemplates: Record<BeatCategory, { scale: string; lens: string; movement: string }> = {
  action: { scale: '中近景', lens: '35mm', movement: '手持跟拍' },
  dialogue: { scale: '过肩中景', lens: '50mm', movement: '固定机位' },
  emotion: { scale: '面部特写', lens: '85mm', movement: '微幅前移' },
  establish: { scale: '大全景', lens: '24mm', movement: '缓慢横移' },
};

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

/** 部位 / 感官词：短词头命中这些字就不是人物名（眼、指尖、脚步、声音…）。 */
const partWords = /眼|目|眉|睫|嘴|脸|面|鼻|唇|喉|牙|舌|耳|腮|脖|颌|颊|胸|腹|腕|臂|掌|指|拳|背|腰|腿|脚|膝|踝|肘|肩|头|额|趾|泪|血|汗|气|声|影|光|风|雨|雪/u;

/** 环境、声音、心理描写不是肢体动作，一律排除。 */
const environmentOnly = /雷|雨|雪|风|光|灯光|夜色|天色|阳光|月光|天气|声音|声响|响|回声|寂静|安静|沉默|空气|气味|温度|气氛|情绪|心里|心中|心头|记忆|回忆|想起|仿佛|似乎|思绪|氛围/u;

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
  过肩中景: '前景肩部虚化，中景人物实焦，背景轻度虚化',
  中近景: '中景主体实焦，前后景轻度虚化',
  面部特写: '浅景深，面部实焦，背景压虚为色块',
};

/** 空镜（无人物主体）时的景深档位：不写「主体」，只写空间。 */
const spaceDepthByScale: Record<string, string> = {
  大全景: '全景深，前景到远景全部清晰',
  过肩中景: '中景实焦，前后景轻度虚化',
  中近景: '中景实焦，前后景轻度虚化',
  面部特写: '浅景深，纵深压虚为色块',
};

/**
 * 合规衔接池：动作接动作、视线引导、遮挡转场、匹配剪辑、J-Cut / L-Cut、声音先入、
 * 空镜缓冲、同向运动顺接、光影变化接、焦点转移接。池内不含具体剧情内容物，避免张冠李戴。
 */
export const transitionPool = [
  '动作接动作：本镜末的抬手动作接下一镜同一动作的继续，动势方向保持一致',
  '视线引导：本镜末人物视线落向画面一侧，下一镜顺视线方向切到目标物',
  '遮挡转场：前景人物肩背横过画面遮蔽，下一镜由遮挡物移开后显露新空间',
  '匹配剪辑：以前景物体的轮廓匹配下一镜的同形物体，形状与画面位置对齐',
  'J-Cut：下一镜的环境声与对话先于画面进入，本镜画面仍在延续',
  'L-Cut：本镜台词延续到下一镜画面，用声音搭桥完成空间切换',
  '声音先入：下一镜的脚步声中先于画面出现，形成听觉预期',
  '空镜缓冲：插入一段空间空镜，承接情绪后再回到人物',
  '同向运动顺接：人物横向移动方向与下一镜机位横移方向一致',
  '光影变化接：本镜末灯光渐次熄灭，下一镜在暗部重新亮起',
  '焦点转移接：焦点从前景人物转移到后景物体，下一镜以该物体为前景',
] as const;

/** 若衔接命中转场禁词，替换为确定性合规衔接（禁词表是硬红线）。 */
export function sanitizeTransition(text: string): string {
  return transitionForbiddenPattern.test(text) ? transitionPool[0] : text;
}

// ── 人物识别 ────────────────────────────────────────────────────────────────

const castCache = new Map<string, string[]>();

/** 叙述句里不能当人物名的词头（环境、部件、泛指、文档层概念），避免把景物或元数据识别成人物。 */
const subjectStopwords = new Set([
  '窗外', '窗外', '夜色', '天色', '房间', '屋里', '屋外', '门外', '门口', '院子', '楼上', '楼下', '空气', '气味', '远处', '近处',
  '两人', '二人', '三人', '他们', '她们', '对方', '彼此', '我们', '你们', '雨点', '雨声', '雨水', '风声', '雪', '灯光', '阳光',
  '月光', '火光', '车流', '脚步', '心跳', '呼吸', '声音', '冷风', '夜风', '微风', '大风', '走廊', '街道', '大厅', '电话', '手机',
  '他', '她', '它', '我', '你', '您', '咱', '谁', '这', '那', '其', '双方',
  // 文档层与道具层概念词：出现频率高，一旦进名册就会被写成「左侧余额与右侧总账」这类站位。
  '余额', '总账', '叙述', '字幕', '面板', '系统', '屏幕', '锁屏', '桌面', '墙上', '门上', '桌上', '床上', '地上', '手上', '身后',
  '文件名', '收件人', '发件人', '标题', '落款', '签名', '日期', '时间', '名字', '序号', '台位', '包间', '卡上', '纸上', '史上',
  '画面', '镜头', '弹幕', '热搜', '监控', '录音', '回放', '名单', '表格', '数据', '数字', '金额', '款项', '预付', '进度',
  '自己', '别人', '大家', '众人', '各位', '旁人', '角色', '人员', '人类',
]);

/** 非人物名词片段：器物、界面、身体部位。命中即不是人名（`军刀` / `刀尖` / `屏幕上` / `收件人昵称`）。 */
const nonPersonFragment = /屏幕|系统|面板|昵称|栏|键盘|鼠标|镜头|鼠标|刀|枪|剑|棍|绳|钱|币|票|证|照|信|纸|键|按钮/u;

/** 副词 / 连接词开头（`再下面一条`）不是人名。 */
const adverbLead = /^[再多又还接着然后随后随即另则]/u;

/**
 * 代词 / 泛指开头（`他自己` / `有人`）不是人名：拒掉后由 `subjectsOf` 的代词镜回填逻辑
 * 继承上镜主体，站位仍写得出真实姓名。
 */
const pronounLead = /^(?:他|她|它|我|你|您|咱|谁|这|那|其|有)/u;

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

function narrationSubjects(text: string, into: string[], push: (name: string) => void): void {
  for (const clause of clausesOf(text)) {
    const index = verbIndexIn(clause);
    if (index <= 0) continue;
    const match = subjectLead.exec(clause.slice(0, index).trim());
    if (!match) continue;
    const name = match[1];
    // 身体部位（指尖 / 脚步 / 肩膀）、短部位词（眼）与数量副词（一步一步）不是人物。
    if (bodyParts.test(name)) continue;
    if (/^[0-9一二三四五六七八九十两半几数]|步$|声$|下$|次$|遍$|着$|了$|的$/u.test(name)) continue;
    push(name);
  }
}

/** 剧本常用单字人物代号（天干），允许作为名册条目；其余单字一律不当作人名。 */
const placeholderName = /^[甲乙丙丁戊己庚辛壬癸]$/u;
/** 句子功能词：命中即说明这是叙述片段而非姓名。 */
const nameFunctionWords = /[的了着是在把被和与就都也还又才只这那不没很更最]/u;

/** 序数 + 量词（`第一句` / `第二条` / `第八名`）不是人名。 */
const ordinalPhrase = /^第?[0-9一二三四五六七八九十百千万]+[句条个名位次场集页行块张支把遍]/u;

/**
 * 名册条目合法性：只接受「像人名的词」。元数据标签、整句叙述、物件与概念词一律不进名册 ——
 * ⑦ 站位与 ④ 构图只能写出真实姓名，这是「站位用代称」的根因闸门。
 */
function isCastName(name: string): boolean {
  if (!name) return false;
  if (name.length > 5) return false;
  if (name.length === 1) return placeholderName.test(name);
  if (/[（(）)〔〕【】\[\]「」『』《》、，。：:；;！？!?…—\-·|/\\\s]/u.test(name)) return false;
  if (/[0-9０-９A-Za-z]/u.test(name)) return false;
  if (nameFunctionWords.test(name)) return false;
  if (ordinalPhrase.test(name)) return false;
  if (adverbLead.test(name)) return false;
  if (pronounLead.test(name)) return false;
  if (nonPersonFragment.test(name)) return false;
  if (briefHeadings.has(labelOf(name))) return false;
  if (subjectStopwords.has(name)) return false;
  if (environmentOnly.test(name)) return false;
  if (name.length <= 2 && partWords.test(name)) return false;
  return true;
}

/** 整本原稿人物名册：人物设定块内的姓名 + 台词说话人（剥离舞台注解）+ 叙述句主体，保持首次出现顺序。 */
export function projectCast(project: Project): string[] {
  const text = project.scripts.map((script) => script.text).join('\n');
  const cached = castCache.get(text);
  if (cached) return cached;
  const names: string[] = [];
  const push = (name: string) => { if (isCastName(name) && !names.includes(name)) names.push(name); };
  for (const script of project.scripts) {
    const parsed = parseScript(script.text);
    parsed.cast.forEach(push);
    for (const beat of parsed.beats) if (beat.kind === 'action') narrationSubjects(beat.text, names, push);
  }
  if (castCache.size > 4) castCache.clear();
  castCache.set(text, names);
  return names;
}

function shotTexts(episode: Episode, shot: Shot): string[] {
  const texts = shot.beatIds.map((id) => episode.beats.find((beat) => beat.id === id)?.text.trim() ?? '').filter(Boolean);
  return [...texts, ...shot.dialogue.map((item) => item.speaker).filter(Boolean)];
}

/** 本镜出现的人物（按本镜文本内的出现顺序）；无人物证据时不臆造主体。 */
function subjectsOf(cast: string[], episode: Episode, shot: Shot, fallback: string[]): string[] {
  const texts = shotTexts(episode, shot);
  const joined = texts.join('\n');
  const names = cast.filter((name) => joined.includes(name)).sort((a, b) => joined.indexOf(a) - joined.indexOf(b));
  if (names.length) return names;
  // 补位镜（无节拍）与代词镜（他 / 她 / 两人）继承上镜主体；纯环境或声音镜没有人物，不继承。
  if (!texts.length) return fallback;
  const hasPerson = bodyParts.test(joined) || facialActions.test(joined) || /^(?:他|她|他们|她们|两人|二人|双方|彼此|对方)/u.test(joined.trim());
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

/** 是否含身体动作证据（节拍分类与 ⑧ 共用同一张动作表）。 */
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
 * ⑧ 肢体动作（方位 / 动线）：原稿动作证据优先；原稿没有动作证据但本镜有人物时，
 * 按剧情档给一条可执行的微动作（`design` 为已选定的强度档文案），不再一律填「无」。
 */
export function actionFor(texts: string[], subjects: string[], primary: string, design = ''): string {
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
      const item = `${who}${rest}（${direction}）`;
      if (!items.includes(item)) items.push(item);
    }
  }
  if (!items.length && subjects.length && design) items.push(`${subjects.join('和')}${design}`);
  return items.length ? items.join('；') : '无';
}

/**
 * ⑨ 微表情：原稿面部 / 呼吸 / 颤抖证据优先；原稿没有证据但本镜有人物时，按剧情档给设计好的
 * 肌群级微表情，不再一律填「无」。空镜（无人物）仍填「无」。
 */
export function performanceFor(texts: string[], subjects: string[], primary: string, design = ''): string {
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
  if (!items.length && subjects.length && design) items.push(`${subjects.join('和')}${design}`);
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

/**
 * 通用底噪：具体地点未命中时，由剧本自带的「内 / 外」与昼夜标记派生 —— 这两个标记写在场次标题里，
 * 属剧本自身信息，不是臆测。`日.内 办公室` 这类标准场次头因此不会漏掉环境层。
 */
function genericAmbience(title: string, covered: Set<AmbienceTopic>): string {
  const indoor = /内/u.test(title);
  const outdoor = /外/u.test(title);
  const night = /夜|深夜|凌晨|傍晚|晚/u.test(title);
  if (indoor) {
    if (night) return '室内夜间环境底噪：灯具电流低鸣与窗外稀疏夜声';
    return covered.has('rain') ? '室内安静空气层与设备低频运转的持续底噪' : '室内环境底噪：空调或风扇低鸣与室外远处人声';
  }
  if (outdoor) return night ? '室外夜间环境底噪：夜风与远处稀疏虫鸣车声' : '室外日间环境底噪：风穿过开阔空间与远处人声车声';
  if (night) return '夜间环境底噪：远处稀疏车声与虫鸣';
  if (/日|白天|清晨|早|午/u.test(title)) return '日间环境底噪：远处零散人声与车流';
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
// 口径：⑧⑨ 先在原稿取证；**原稿没有可观察证据时，按剧情语义设计**，不再一律填「无」。
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
 */
const emotionDesigns: Record<EmotionKey, { face: [string, string, string]; body: [string, string, string] }> = {
  suppressed: {
    face: ['眉尾压平，上眼睑下落盖住瞳孔上缘，嘴唇抿紧向内收', '眉尾向两侧压平拉长，嘴唇抿成一条直线，下颌轻微收拢', '眉心挤出一条浅竖纹，嘴唇抿住下压，喉结滚动一次'],
    body: ['重心压在后脚掌，双肩向内收拢', '重心压在后脚掌，双肩向内收拢，手指在身侧收紧半寸', '肩线同时向内压低，双手在身前交握后收紧'],
  },
  startled: {
    face: ['眉尾上抬，上眼睑抬高露出上缘眼白，嘴微张后合上', '眉毛整体上抬，上眼睑抬高露出眼白，嘴微张停住半拍', '眉毛窜高，上眼睑完全抬高，嘴张开后僵住，呼吸停在半口气上'],
    body: ['重心向后移半个脚掌', '重心向后移半个脚掌，上身后仰一寸', '重心向后移半个脚掌，上身后仰一寸，一侧手臂抬起挡在胸前'],
  },
  hostile: {
    face: ['眉头向中间下压，视线锁定对方眼睛不动', '眉头向中间下压挤出一条短竖纹，鼻翼向外扩张一次', '眉头下压挤成竖纹，鼻翼扩张，下颌前送，咬肌鼓起'],
    body: ['肩线抬高，一侧手肘向外撑开', '肩线抬高，一侧手肘向外撑开，前臂绷紧压向身体中线', '肩线抬高，上身前压，手指收拢握紧停在身侧中线'],
  },
  grieving: {
    face: ['上眼睑下垂，视线落在下方一点不动', '上眼睑下垂，下睫毛处聚起一层薄泪膜，嘴角向下牵动一次', '上眼睑下垂，泪膜在下眼睑边缘挂住不掉，嘴角向下牵着，鼻孔微张'],
    body: ['肩膀塌下，双手垂在身侧', '肩膀塌下半寸，头颈向前低倾，双手在身前交握收紧', '肩膀塌下半寸，上身向前折低，双手撑在膝上，指节压到发白'],
  },
  pleading: {
    face: ['眉头内侧向上提起，眼睑放松', '眉头内侧向上提起，眼睑放松，嘴角向后下方拉开', '眉头内侧向上提起，嘴角向后下方拉开，喉结滚动一次，视线不离开对方'],
    body: ['上身前倾一寸', '上身前倾一寸，双手停在身前中线位置', '上身前倾一寸，双手向前伸出停在对方身前，手指张开'],
  },
  scheming: {
    face: ['视线从对方眼睛移向嘴角再回正', '视线从对方眼睛移向嘴角再回正，单侧唇角上提而眼轮匝肌不动', '视线在对方眼睛与嘴角间来回一次，单侧唇角上提且眼轮匝肌不动，下巴轻微偏转'],
    body: ['上身保持不动', '上身保持不动，一侧手指在身侧轻点一次', '上身保持不动，一侧手指在身侧轻点两次，脚尖转向出口方向'],
  },
  resolved: {
    face: ['眼睑收窄，视线落定在对手面部一点', '眼睑收窄，视线落定不动，咬肌轻微鼓起', '眼睑收窄，视线锁死一点不动，咬肌鼓起，下颌前送半寸'],
    body: ['重心前移压向前脚掌', '重心前移压向前脚掌，脊背立直', '重心前移压向前脚掌，脊背立直，双手在身侧握紧，动线一次性走完'],
  },
  weary: {
    face: ['眼睑半垂，眉心放松', '眼睑半垂，眉心放松后抽动一下，呼吸变浅', '眼睑半垂，眉心抽动一下，呼吸变浅变长，嘴角向下松开'],
    body: ['肩线松垮下坠', '肩线松垮下坠，重心在双脚间小幅晃动', '肩线松垮下坠，上身歪向一侧，单手撑住近处的支撑面'],
  },
  warm: {
    face: ['眼角细纹舒展，嘴角自然上提', '眼轮匝肌收缩使眼角出现细纹，嘴角上提，眉尾放松上抬', '眼轮匝肌收缩挤出眼角细纹，嘴角上提，眉尾放松上抬，呼吸放缓一次'],
    body: ['肩线放松下沉', '肩线放松下沉，上身向对方一侧轻转十五度', '肩线放松下沉，上身向对方轻转，重心向对方方向挪半步'],
  },
  neutral: {
    face: ['眼睑放松，视线落在对方眼睛与嘴之间', '眼睑放松，视线在对方眼睛与嘴之间移动一次，呼吸平稳', '眼睑放松，视线在眼睛与嘴之间移动一次，眉心不收紧，呼吸幅度均匀'],
    body: ['重心居中，双肩平齐', '重心居中，双肩平齐，双手停在身体两侧', '重心居中，双肩平齐，双手停在身体两侧，指尖轻微活动一次'],
  },
};

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

export function stagingFor(category: BeatCategory, subjects: string[], inherited: string): Staging {
  if (!subjects.length) {
    return { subjects, side: '', anchor: '画面无人物主体，以空间层次为构图主体', blocking: '本镜无人物入画，空间关系占据画面，机位保持在场次轴线一侧' };
  }
  if (subjects.length >= 2) {
    const [left, right] = subjects;
    const carry = inherited.includes(`左侧${left}`) ? '，承接上镜轴线不变' : '';
    return {
      subjects, side: '左', anchor: '主体分列画面左右三分之一',
      blocking: `左侧${left}与右侧${right}分列画面左右三分之一，两人正面相对，视线在画面中部相接；轴线为两人连线，锁定在画面水平中轴${carry}`,
    };
  }
  const name = subjects[0];
  if (category === 'emotion') {
    return { subjects, side: '中', anchor: '主体位于画面中央', blocking: `${name}位于画面中央，正面朝向镜头，左右留白基本对称` };
  }
  const side = category === 'establish' ? '右' : '左';
  const opposite = side === '左' ? '右' : '左';
  const carry = inherited.startsWith(name) ? '，延续上镜轴线' : '';
  return {
    subjects, side, anchor: `主体位于画面${side}三分之一`,
    blocking: `${name}位于画面${side}三分之一，身体朝向画面${opposite}侧，视线落在画面${opposite}三分之一${carry}`,
  };
}

/** ④ 构图：视线焦点 + 景别景深 + 留白 + 框中框 / 纵深；主体位置与 ⑦ 站位同源。 */
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
 * ④ 构图与 ⑦ 站位是否互相矛盾（主体被写到相反一侧）。
 * 判定保守：只在两侧都给出唯一且相反的主体位置时成立，双人或无人物镜头一律不判矛盾。
 */
export function compositionContradictsStaging(composition: string, blocking: string): boolean {
  const sideOf = (text: string): '' | '左' | '右' | '中' => {
    const left = text.includes('左三分之一') || text.includes('画面左');
    const right = text.includes('右三分之一') || text.includes('画面右');
    if (left && right) return '';
    if (left) return '左';
    if (right) return '右';
    return text.includes('画面中央') ? '中' : '';
  };
  const staged = sideOf(blocking);
  const framed = sideOf(composition);
  if (!staged || !framed || staged === '中' || framed === '中') return false;
  return staged !== framed;
}

// ── 场景锚点 ────────────────────────────────────────────────────────────────

function analysisFor(project: Project, episode: Episode, segment: Segment, analysisByImage: Map<string, ImageAnalysis>): ImageAnalysis | undefined {
  const images = segment.imageIds.map((id) => episode.images.find((image) => image.id === id)).filter((image): image is NonNullable<typeof image> => !!image);
  const ordered = [...images.filter((image) => image.kind === 'scene'), ...images.filter((image) => image.kind !== 'scene')];
  for (const image of ordered) {
    const analysis = analysisByImage.get(image.id) ?? image.analysis;
    if (analysis) return analysis;
  }
  return undefined;
}

function lightFor(analysis: ImageAnalysis | undefined): string {
  if (!analysis) return '自然散射光，中性色温，中等照度';
  const direction = { top: '顶部来光', left: '左侧来光', right: '右侧来光', bottom: '底部反光', flat: '均匀散射光' }[analysis.lightDirection];
  const temperature = { warm: '暖色温', cool: '冷色温', neutral: '中性色温' }[analysis.temperature];
  const level = analysis.brightness > 0.62 ? '高照度' : analysis.brightness > 0.38 ? '中等照度' : '低照度';
  return `${direction}，${temperature}，${level}`;
}

function atmosphereFor(analysis: ImageAnalysis | undefined): string {
  if (!analysis) return '环境光均匀，情绪平稳';
  const temperature = { warm: '暖调', cool: '冷调', neutral: '中性调' }[analysis.temperature];
  const mood = analysis.saturation > 0.45 ? '色彩饱满' : analysis.saturation > 0.25 ? '色彩克制' : '低饱和';
  const space = analysis.indoor === 'indoor' ? '室内封闭' : analysis.indoor === 'outdoor' ? '室外开阔' : '空间层次待定';
  return `${temperature}${mood}，${space}`;
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

export type ShotEvidence = { composition: string; blocking: string; action: string; performance: string; sound: string };

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
      blocking = stagingFor(startOfBeat(episode.beats.find((beat) => shot.beatIds.includes(beat.id))), names, blocking).blocking;
      subjects = names;
    }
  }
  return { cast, subjects, blocking };
}

/** 证据型字段正本：④构图 ⑦站位 ⑧肢体动作 ⑨微表情 ⑬音效。 */
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
  const template = shotTemplates[category];
  const staging = stagingFor(category, names, blocking);
  // 剧情档：台词 + 叙述 + 节拍类型定情绪，人物弧光定强度；原稿有证据时以证据为准。
  const emotion = emotionKeyOf(category, shotTexts(episode, shot));
  const level = primary ? designLevelOf(project, episode, primary) : 1;
  return {
    composition: compositionFor(staging, category, template.scale),
    blocking: staging.blocking,
    action: actionFor(texts, names, primary, emotionDesigns[emotion].body[level]),
    performance: performanceFor(texts, names, primary, emotionDesigns[emotion].face[level]),
    sound: soundFor(texts, sceneTitle),
  };
}

/**
 * 规则导演：为整集逐段生成 10 条可生成字段（③④⑤⑥⑦⑧⑨⑩⑪⑬⑭）。
 * 证据型字段与写入边界共用 sourceFieldsForShot；衔接取自合规池并过滤禁词。
 * 确定性实现，可重复可单测。
 */
export function generateEpisodeDrafts(project: Project, episode: Episode, analysisByImage: Map<string, ImageAnalysis> = new Map()): Map<string, ShotDraft[]> {
  const result = new Map<string, ShotDraft[]>();
  episode.segments.forEach((segment, segmentIndex) => {
    const analysis = analysisFor(project, episode, segment, analysisByImage);
    const light = lightFor(analysis);
    const atmosphere = atmosphereFor(analysis);
    const drafts: ShotDraft[] = segment.shots.map((shot, shotIndex) => {
      const beat = episode.beats.find((item) => shot.beatIds.includes(item.id));
      const category = startOfBeat(beat);
      const template = shotTemplates[category];
      const nextShot = segment.shots[shotIndex + 1];
      const nextBeat = nextShot ? episode.beats.find((item) => nextShot.beatIds.includes(item.id)) : undefined;
      const nextSegment = episode.segments[segmentIndex + 1];
      const nextCategory = nextShot ? startOfBeat(nextBeat) : nextSegment ? startOfBeat(episode.beats.find((item) => nextSegment.beatIds.includes(item.id))) : category;
      const transition = sanitizeTransition(nextShot ? transitionPool[(segmentIndex + shotIndex + 1) % transitionPool.length] : `交棒下一段：保持轴线与人物方位不变，以${nextCategory === 'action' ? '动作起势' : nextCategory === 'emotion' ? '视线与呼吸' : '环境声'}进入下一段`);
      const purpose = purposeFor(category, beat, nextCategory);
      const evidence = sourceFieldsForShot(project, episode, shot);
      const fields: Partial<Record<EditableShotKey, string>> = {
        scale: template.scale, composition: evidence.composition, lens: template.lens, movement: template.movement,
        light, atmosphere, blocking: evidence.blocking,
        action: evidence.action, performance: evidence.performance, sound: evidence.sound,
        transition,
      };
      return { shotId: shot.id, purpose, duration: 15, fields, source: 'local' as const };
    });
    result.set(segment.id, drafts);
  });
  return result;
}

export function generatedFieldCount(drafts: ShotDraft[]): number {
  return drafts.reduce((sum, draft) => sum + generatedKeys.filter((key) => !!draft.fields[key]?.trim()).length, 0);
}
