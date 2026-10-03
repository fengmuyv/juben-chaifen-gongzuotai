import type { Beat, Dialogue, Scene } from './model';
import type { Dialogue as DialogueFragment } from './model';

export type ScriptStructure = { scenes: Scene[]; beats: Beat[]; cast: string[] };

export function effectiveLength(text: string): number {
  return [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).length;
}

const cnDigits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const cnUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 解析中文数字（支持 一 / 十 / 十二 / 二十三 / 一百零五 等常规写法）。集号解析的单一来源。 */
export function parseChineseNumber(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  let section = 0;
  let current = 0;
  for (const char of text) {
    if (char in cnDigits) { current = cnDigits[char]; continue; }
    if (char in cnUnits) { section += (current || 1) * cnUnits[char]; current = 0; continue; }
    return null;
  }
  const total = section + current;
  return total > 0 ? total : null;
}

/** 分集标记行：第N集 / 第N话 / EP0N / Episode 0N，可后接标题。parser 与 episodes 共用同一口径。 */
const episodeCapture = /^\s*(?:第\s*([0-9]{1,4}|[零一二三四五六七八九十百千两]{1,8})\s*[集话章]|(?:EP|EPISODE)\s*([0-9]{1,4}))\s*(?:[：:、.．\-—]\s*)?(.*)$/iu;

/** 命中返回 [整行, 中文或阿拉伯集号, EP 集号, 标题]，未命中返回 null。 */
export function matchEpisodeMarker(line: string): RegExpExecArray | null {
  return episodeCapture.exec(line);
}

export function isEpisodeMarker(line: string): boolean {
  return matchEpisodeMarker(line) !== null;
}

export type EpisodeHeading = {
  /** 集号；无法解析时为 null。 */
  number: number | null;
  title: string;
  /** `heading` = 真集标（可作分集切点）；`preface` = 集头导语（整句简介，不作切点，但仍不是正文）。 */
  kind: 'heading' | 'preface';
};

/** 被引号/书名号包住的短标题：`第 2 集「她啐了我一口」`。 */
const quotedTitle = /^[「『《【（(]/u;

/** 标题部本身又是集号清单（附录索引行 `EP31—EP60` / `EP19 / EP39 / EP52`），不是真集标。 */
const episodeIndexTitle = /^[\s/、·—–-]*(?:EP|Episode|第)\s*[0-9]/iu;

/**
 * 集标行判定（单一来源）：
 * `第 2 集「她啐了我一口」` 是真集标；`第 2 集：扫荡戏开拍。一个八岁的小女孩，临场加了一句台词。`
 * 是**集头导语**（整句简介），若当切点会把 60 集切成 167 段。两类都不是正文，都必须丢弃，
 * 但只有真集标能作分集切点。
 */
export function episodeHeadingOf(line: string): EpisodeHeading | null {
  const match = matchEpisodeMarker(line);
  if (!match) return null;
  const [, cn, en, rawTitle] = match;
  const title = (rawTitle ?? '').trim();
  const number = cn ? (/^[0-9]+$/.test(cn) ? Number(cn) : parseChineseNumber(cn)) : en ? Number(en) : null;
  const isPreface = !!title
    && !quotedTitle.test(title)
    && (episodeIndexTitle.test(title) || /[。！？；]/u.test(title) || effectiveLength(title) > 14);
  return { number, title, kind: isPreface ? 'preface' : 'heading' };
}

/**
 * 非正文块标题（单一来源）：命中的标题及其**下属内容**都不是可拍摄剧情，
 * 一律不进节拍、不进分镜。这是「故事梗概 / 来源 / 人物设定被写进分镜」的根因闸门。
 */
export const briefHeadings = new Set([
  '来源', '出处', '原著', '原作', '作者', '编剧', '类型', '题材', '风格', '标签', '平台', '集数', '总集数',
  '时长', '单集时长', '画幅', '比例', '分辨率', '受众', '定位', '备注', '版本', '修订', '日期', '项目', '片名', '剧名',
  '人物设定', '角色设定', '人物小传', '角色小传', '人物简介', '角色简介', '人物表', '角色表', '主要人物', '人物关系',
  '故事梗概', '剧情梗概', '内容提要', '剧情简介', '故事简介', '梗概', '简介', '一句话简介',
  '大纲', '分集大纲', '剧情大纲', '故事大纲', '世界观', '设定', '基础设定', '核心设定', '创作说明', '创作笔记',
  '主题', '卖点', '核心看点', '看点', '剧情模板', '分镜模板', '模板',
  // 定稿剧本的集头九字段与门禁表标签（`播放时长：…｜纯发声字数：…` 这类行不是剧情）。
  '播放时长', '纯发声字数', '正文字数', '金句', '节奏', '集首钩子', '集尾钩子', '付费卡点', '名场面', '二创点',
  '付费卡点结构', '集尾钩子模式', '集首钩子模式',
  '门禁项', '门禁', '定稿门禁', '口径', '口径说明', '结果', '项', '内容', '序号', '结论', '形态', '体量',
  '全剧实测', '源脚本系列', '定稿状态', '残余', '附录', '后记',
  // 真实定稿剧稿的前言统计表与附录「补写说明」：这些标签后的内容全是文档层账目，不是剧情。
  '总账', '动因', '做法', '六道护栏', '三条验收断言', '画面密度', '叙述', '路A补写说明',
]);

/** 人物设定类标题：这些块内的人名进人物名册，但块内正文仍然不进节拍。 */
const castHeadings = new Set(['人物设定', '角色设定', '人物小传', '角色小传', '人物简介', '角色简介', '人物表', '角色表', '主要人物', '人物关系']);

const boldLine = /^\s*\*\*\s*([^*]*?)\s*\*\*\s*(.*)$/u;
const bracketLine = /^\s*[【\[]\s*([^】\]]*?)\s*[】\]]\s*(.*)$/u;
const plainLabel = /^\s*([^：:\n]{1,20})[：:]\s*(.*)$/u;
const hashHeading = /^\s*#{1,6}\s+(.+)$/u;

/** 制作层结构标记：幕标记、CUT TO、英文转场。不是可拍摄剧情。 */
const structureMarker = /^\s*【?\s*(?:第[一二三四五六七八九十]+幕|CUT\s*TO|SCENE\s*\d|FADE\s|DISSOLVE)/iu;

/** 标签去噪：剥离加粗、括号、列表符号、空白与冒号，只留词干用于查表。 */
export function labelOf(raw: string): string {
  return raw.replace(/[\s*【】\[\]（）()：:.—–\-_·•]/gu, '');
}

/** 取该行的标题标签与同行值（按加粗 / 方括号 / 井号 / 普通「标签：」依次判定）。 */
function headingPartsOf(line: string): { label: string; raw: string; value: string } | null {
  const bold = boldLine.exec(line);
  if (bold) return { label: labelOf(bold[1]), raw: bold[1], value: bold[2].trim() };
  const bracket = bracketLine.exec(line);
  if (bracket) return { label: labelOf(bracket[1]), raw: bracket[1], value: bracket[2].trim() };
  const hash = hashHeading.exec(line);
  if (hash) return { label: labelOf(hash[1]), raw: hash[1], value: '' };
  const plain = plainLabel.exec(line);
  if (plain) return { label: labelOf(plain[1]), raw: plain[1], value: plain[2].trim() };
  return null;
}

export type HeadingKind = 'block' | 'field' | 'none';

/** 中文序号小节标题：`二、口径说明`。文档层结构，不是可拍摄剧情。 */
const numberedSection = /^\s*[一二三四五六七八九十]{1,3}\s*[、.．]/u;

/** `残余（登记，不掩盖）` / `定稿门禁（全绿）`：词干带括号注解的标题。 */
const stemBeforeParen = /^\s*([\u4e00-\u9fa5A-Za-z]{2,6})\s*[（(]/u;

/**
 * 标签是否属于非正文表：本体命中，或本体带括号注解时**词干**命中
 * （`六道护栏（全部通过）` / `三条验收断言（全部通过）` 这类附录小标题）。
 */
function isBriefLabel(label: string, raw = label): boolean {
  if (briefHeadings.has(label)) return true;
  const stem = stemBeforeParen.exec(raw.trim())?.[1];
  return !!stem && briefHeadings.has(stem);
}

/**
 * 行分类：`block` = 非正文块标题（连同下属内容整体丢弃）；
 * `field` = 单行元数据（只丢这一行，如 `**来源：** 某某`）；`none` = 可能是正文。
 */
export function headingKindOf(line: string): HeadingKind {
  const parts = headingPartsOf(line);
  if (parts) return isBriefLabel(parts.label, parts.raw) ? (parts.value ? 'field' : 'block') : 'none';
  if (isBriefLabel(labelOf(line), line)) return 'block';
  if (numberedSection.test(line)) return 'block';
  return 'none';
}

/** 是否非正文块标题行（导入入口的说明文档识别共用同一口径）。 */
export function isBriefHeadingLine(line: string): boolean {
  return headingKindOf(line) === 'block';
}

/**
 * 元数据行：整行是表头单词（项 / 内容 / 口径），或由多个「标签：值」字段以 ｜ 拼成一行的
 * 集头九字段（`播放时长：约 69 秒｜纯发声字数：约 262 字｜金句：…`）。都不是可拍摄剧情。
 */
export function isMetadataLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (structureMarker.test(trimmed)) return true;
  if (briefHeadings.has(labelOf(trimmed))) return true;
  const cells = trimmed.split(/[｜|]/u).map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2) return false;
  return cells.some((cell) => {
    const parts = plainLabel.exec(cell);
    return !!parts && briefHeadings.has(labelOf(parts[1]));
  });
}

/** 说话人剥离舞台注解：`林昊（画外音）` → `林昊`。注解是导演信息，不作为人物名。 */
export function normalizeSpeaker(raw: string): string {
  return raw.replace(/[（(【\[][^）)】\]]*[）)】\]]/gu, '').replace(/[\s·、，。]+$/u, '').trim();
}

/**
 * 说话人注解外的裸名（`林昊（画外音）` → `林昊`、`评委 A（对着话筒）` → `评委A`）。
 * **单一来源**：名册登记、说话人可信度判定与 ⑨ 站位的名字都取它；⑫ 台词仍保留原稿原文（零篡改）。
 */
export function speakerNameOf(raw: string): string {
  return normalizeSpeaker(raw).replace(/\s+/gu, '');
}

// ── 人物判据（单一来源）─────────────────────────────────────────────────────
//
// 解析器与生成器共用同一份判据：解析期用它决定「这一行是台词还是叙述」，
// 生成期用它决定「谁可以写进 ⑨站位 / ④构图」。两处不得各写一套词表。

/** 叙述句里不能当人物名的词头（环境、部件、泛指、文档层概念），避免把景物或元数据识别成人物。 */
export const subjectStopwords = new Set([
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

/** 部位 / 感官词：短词头命中这些字就不是人物名（眼、指尖、脚步、声音…）。 */
export const partWords = /眼|目|眉|睫|嘴|脸|面|鼻|唇|喉|牙|舌|耳|腮|脖|颌|颊|胸|腹|腕|臂|掌|指|拳|背|腰|腿|脚|膝|踝|肘|肩|头|额|趾|泪|血|汗|气|声|影|光|风|雨|雪/u;

/** 环境、声音、心理描写不是肢体动作，一律排除。 */
export const environmentOnly = /雷|雨|雪|风|光|灯光|夜色|天色|阳光|月光|天气|声音|声响|响|回声|寂静|安静|沉默|空气|气味|温度|气氛|情绪|心里|心中|心头|记忆|回忆|想起|仿佛|似乎|思绪|氛围/u;

/** 非人物名词片段：器物、界面、身体部位。命中即不是人名（`军刀` / `刀尖` / `屏幕上` / `收件人昵称`）。 */
const nonPersonFragment = /屏幕|系统|面板|昵称|栏|键盘|鼠标|镜头|鼠标|刀|枪|剑|棍|绳|钱|币|票|证|照|信|纸|键|按钮/u;

/** 字段 / 文档层名词结尾（`发送时间` / `通话时长` / `账号号码`）：`标签：值` 是叙述行，不是台词。 */
const fieldLabelTail = /(?:时间|日期|时长|序号|编号|号码|账号|密码|名称|名字|标题|落款|备注|状态|总额|余额|金额|数量|地址|位置|内容|类型|版本)$/u;

/** 含泛指主体词（`下面有人喊` / `旁边某人`）：整行是舞台指示，不是说话人。 */
const vaguePerson = /有人|某人|那人|这人/u;

/** 副词 / 连接词开头（`再下面一条`）不是人名。 */
const adverbLead = /^[再多又还接着然后随后随即另则]/u;

/**
 * 代词 / 泛指开头（`他自己` / `有人` / `那个人`）不是人名：拒掉后由 `subjectsOf` 的代词镜回填逻辑
 * 继承上镜主体，站位仍写得出真实姓名。
 */
const pronounLead = /^(?:他|她|它|我|你|您|咱|谁|这|那|其|有)/u;

/** 剧本常用单字人物代号（天干），允许作为名册条目；其余单字一律不当作人名。 */
const placeholderName = /^[甲乙丙丁戊己庚辛壬癸]$/u;

/** 句子功能词：命中即说明这是叙述片段而非姓名。 */
const nameFunctionWords = /[的了着是在把被和与就都也还又才只这那不没很更最]/u;

/** 序数 + 量词（`第一句` / `第二条` / `第八名`）不是人名。 */
const ordinalPhrase = /^第?[0-9一二三四五六七八九十百千万]+[句条个名位次场集页行块张支把遍]/u;

/** 数词 + 量词内嵌（`抬头四个字` / `打了三个字` / `一步一步`）：数量短语，不是人名。 */
const quantifierPhrase = /[0-9一二三四五六七八九十百千万两几数][个字行句名位次场集页块张支把遍条目组批步]/u;

/** 方位 / 处所后缀（`窗口后` / `电话那头` / `屏幕上`）：空间描述，不是人名。 */
const locativeTail = /(?:后|前|里|外|上|下|中|旁|那头|那边|这头|这边|里头|外头)$/u;

/** 引号与星号：叙述行残留的引用符，人名里不会出现。 */
const quoteNoise = /["'“”‘’*]/u;

/**
 * 名册条目合法性：只接受「像人名的词」。元数据标签、整句叙述、物件与概念词一律不进名册 ——
 * ⑨ 站位与 ④ 构图只能写出真实姓名，这是「站位用代称」的根因闸门。解析器与生成器共用。
 */
export function isCastName(name: string): boolean {
  if (!name) return false;
  if (name.length > 5) return false;
  if (name.length === 1) return placeholderName.test(name);
  if (/[（(）)〔〕【】\[\]「」『』《》、，。：:；;！？!?…—\-·|/\\\s]/u.test(name)) return false;
  if (quoteNoise.test(name)) return false;
  if (/[0-9０-９A-Za-z]/u.test(name)) return false;
  if (nameFunctionWords.test(name)) return false;
  if (ordinalPhrase.test(name)) return false;
  if (quantifierPhrase.test(name)) return false;
  if (adverbLead.test(name)) return false;
  if (pronounLead.test(name)) return false;
  if (nonPersonFragment.test(name)) return false;
  if (fieldLabelTail.test(name)) return false;
  if (vaguePerson.test(name)) return false;
  if (locativeTail.test(name)) return false;
  if (briefHeadings.has(labelOf(name))) return false;
  if (subjectStopwords.has(name)) return false;
  if (environmentOnly.test(name)) return false;
  if (name.length <= 2 && partWords.test(name)) return false;
  return true;
}

/**
 * 角色称谓：不是姓名，但确实是剧本里的人物主体（记者甲 / 投资方代表 / 大爷 / 收银员…）。
 * **单一来源**：① 说话人可信度判定（`speakerTrusted`）；② 叙述句主语的**佐证通道**
 * （生成层 `projectCast` 只认「已确证姓名」或本表命中，用于登记只以泛称出场的人物，如小女孩 / 老人 / 鬼子兵）。
 */
export const roleSpeaker = /代表|评委|记者|主持|导播|场务|群演|制片|摄影|化妆|道具|灯光|场记|录音|护士|医生|保安|警察|服务员|收银|前台|同事|同学|邻居|观众|粉丝|水军|网友|大爷|大妈|妇女|汉子|路人|司机|助理|工作人员|投资方|姑娘|小伙|老人|男人|女人|母亲|父亲|亲戚|村民|摊主|老板|店员|学生|老师|考生|选手|学员|家属|替身|女孩|男孩|孩子|老头|老太太|兵/u;

/** 角色 + 天干（`群演甲` / `评委乙`）。 */
const numberedRole = /^[\u4e00-\u9fa5]{1,4}[甲乙丙丁戊己庚辛壬癸]$/u;

/**
 * 台词说话人是否可信（单一来源）：不可信的「标签：值」行是**叙述行**
 * （`余额：2,430。` / `门上贴着三个字：…` / `画面猛地拉开：一把军刀…`），
 * 必须按 action 处理 —— 既不得进 ⑫ 台词，也不得占用「确凿台词行」解屏正文块。
 */
export function speakerTrusted(label: string, cast: string[] = []): boolean {
  const stem = speakerNameOf(label);
  if (!stem) return false;
  if (cast.includes(stem)) return true;
  if (isCastName(stem)) return true;
  if (locativeTail.test(stem)) return false;
  if (numberedRole.test(stem)) return true;
  return roleSpeaker.test(stem) && stem.length <= 6;
}

function isCastHeading(line: string): boolean {
  const parts = headingPartsOf(line);
  return !!parts && castHeadings.has(parts.label);
}

/** 场次标题行：# 标题 / 第N场 / 场次 N / 场景 N / 内景.外景 / INT. / EXT. */
function isSceneHeading(line: string): boolean {
  return /^(?:#{1,6}\s+|第[^\s]{1,12}场|场次\s*\d|场景\s*\d|(?:内|外)[.． /-]|INT\.|EXT\.)/iu.test(line);
}

/** 确凿的正文台词行：说话人**可信**的 `说话人：内容`，或括号内的旁白 / 内心标记。 */
function isTrustedDialogueLine(line: string, cast: string[]): boolean {
  if (/^[(（]\s*(?:旁白|内心(?:OS)?|OS|心声|独白)/iu.test(line)) return true;
  const parts = headingPartsOf(line);
  return !!parts && !!parts.value && speakerTrusted(parts.raw, cast);
}

// Only natural punctuation boundaries may split a protected source dialogue.
function splitDialogue(speaker: string, text: string, offset: number, kind: DialogueFragment['kind'] = 'dialogue'): Dialogue[] {
  const clauses = [...text.matchAll(/[^，。！？；,!?;]+[，。！？；,!?;]*|[，。！？；,!?;]+/gu)];
  const result: Dialogue[] = [];
  let current = '';
  let start = offset;
  for (const clause of clauses) {
    if (current && effectiveLength(current + clause[0]) > 44) {
      result.push({ speaker, text: current, kind, range: { start, end: start + current.length } });
      start = offset + clause.index;
      current = '';
    }
    current += clause[0];
  }
  if (current) result.push({ speaker, text: current, kind, range: { start, end: start + current.length } });
  return result;
}

/** 人物设定条目：`姓名——描述` / `姓名：描述` / `姓名（年龄…）` / `- 姓名，描述`。 */
const castEntry = /^[\s\-*•·>*]*([\u4e00-\u9fa5A-Za-z·]{2,6})\s*(?:——|--|—|–|[:：]|[（(]|，|,|\s)/u;

function castNamesOf(line: string, into: string[]): void {
  const match = castEntry.exec(line);
  if (!match) return;
  const name = match[1].trim();
  if (name.length < 2 || briefHeadings.has(labelOf(name)) || /^(?:旁白|内心|OS|心声|独白)$/iu.test(name)) return;
  if (!into.includes(name)) into.push(name);
}

export function parseScript(text: string): ScriptStructure {
  const scenes: Scene[] = [];
  const beats: Beat[] = [];
  const cast: string[] = [];
  let cursor = 0;
  let currentScene: Scene | undefined;
  let skip: 'none' | 'cast' | 'other' = 'none';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const start = cursor + line.indexOf(trimmed);
    const end = start + trimmed.length;
    cursor += line.length + 1;
    if (!trimmed) continue;

    // 非正文块内：新块标题重置块类型；块内正文不生成节拍，只有人物设定块顺带登记姓名。
    // 解屏条件收紧为「分集标记 / 场次标题 / 可信台词行」—— 单行元数据（`动因：…`）不得提前解屏，
    // 否则前言统计表与附录「补写说明」会整段涌进节拍。
    if (skip !== 'none') {
      if (isEpisodeMarker(trimmed)) { skip = 'none'; continue; }
      const kind = headingKindOf(trimmed);
      if (kind !== 'none') { skip = kind === 'block' && isCastHeading(trimmed) ? 'cast' : 'other'; continue; }
      // 人物设定块内 `姓名：描述` 形态条目不得当台词解屏，只登记姓名。
      const escapes = isSceneHeading(trimmed) || (skip !== 'cast' && isTrustedDialogueLine(trimmed, cast));
      if (!escapes) {
        if (skip === 'cast') castNamesOf(trimmed, cast);
        continue;
      }
      skip = 'none';
    }

    const heading = headingKindOf(trimmed);
    if (heading === 'field') continue;
    if (heading === 'block') { skip = isCastHeading(trimmed) ? 'cast' : 'other'; continue; }

    if (isSceneHeading(trimmed)) {
      if (currentScene) currentScene.range.end = start;
      currentScene = { id: `scene-${scenes.length + 1}`, title: trimmed.replace(/^#+\s*/, ''), range: { start, end: text.length } };
      scenes.push(currentScene);
      continue;
    }
    // 场次判完再判元数据：集头九字段、幕标记、CUT TO 等制作层内容不进节拍。
    if (isMetadataLine(trimmed)) continue;
    if (isEpisodeMarker(trimmed)) continue;
    if (!currentScene) {
      currentScene = { id: 'scene-1', title: '未标注场次', range: { start, end: text.length } };
      scenes.push(currentScene);
    }
    const match = !/^[（(\[]/u.test(trimmed) ? /^([^：:\n]{1,20})[：:]\s*(.+)$/u.exec(trimmed) : null;
    const addBeat = (dialogue?: Dialogue) => beats.push({
      id: `beat-${beats.length + 1}`, sceneId: currentScene!.id, kind: dialogue ? 'dialogue' : 'action',
      text: dialogue?.text ?? trimmed, range: dialogue?.range ?? { start, end }, dialogue,
    });
    if (match) {
      const label = match[1].trim();
      const normalized = label.replace(/[\s._-]/gu, '').toLowerCase();
      const kind: DialogueFragment['kind'] = /旁白|narration|voiceover|vo/u.test(normalized) ? 'narration' : /内心|os|心声|独白/u.test(normalized) ? 'inner' : 'dialogue';
      // 说话人不可信（`余额：2,430。` / `门上贴着三个字：…` 这类叙述行含全角冒号）→ 按叙述处理。
      if (kind === 'dialogue' && !speakerTrusted(label, cast)) { addBeat(); continue; }
      // 名册只登记剥掉舞台注解后的词干：`林昊（画外音）` → `林昊`；台词原文保持零篡改。
      const stem = speakerNameOf(label);
      if (kind === 'dialogue' && stem && !cast.includes(stem)) cast.push(stem);
      const dialogueStart = start + trimmed.length - match[2].length;
      splitDialogue(kind === 'dialogue' ? label : kind === 'narration' ? '旁白' : '内心OS', match[2], dialogueStart, kind).forEach(addBeat);
    } else {
      const tagged = /^[(（]\s*(旁白|内心(?:OS)?|OS|心声|独白)\s*[：:]\s*([^）)\]]*?)[)）\]]$/iu.exec(trimmed)
        ?? /^[(（]\s*(旁白|内心(?:OS)?|OS|心声|独白)\s*([^）)\]]*?)[)）\]]$/iu.exec(trimmed)
        ?? /^((?:旁白|内心(?:OS)?|OS|心声|独白))\s*[：:]\s*(.+)$/iu.exec(trimmed);
      if (tagged) {
        const label = tagged[1];
        const capturedBody = tagged[2];
        const kind: DialogueFragment['kind'] = /旁白/u.test(label) ? 'narration' : 'inner';
        const body = capturedBody.trim().replace(/[）)\]]\s*$/u, '');
        const bodyStart = start + trimmed.lastIndexOf(capturedBody);
        splitDialogue(kind === 'narration' ? '旁白' : '内心OS', body, bodyStart, kind).forEach(addBeat);
      } else addBeat();
    }
  }
  return { scenes, beats, cast };
}
