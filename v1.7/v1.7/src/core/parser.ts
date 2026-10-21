import type { Beat, Dialogue, Scene } from './model';
import type { Dialogue as DialogueFragment } from './model';

/**
 * 解析契约版本（**分集 / 正文识别口径的版本指纹**）。
 *
 * 为什么要它（2026-10-05 定案）：分集结果是**持久化**的 —— 导入那一刻由本文件切好、写进存档。
 * 之后升级本文件的识别口径，**已存在的存档不会自动重算**：用户打开还是旧分集
 * （实测：`### 第七集` 修复前后，同一份原稿在存档里仍是「第01集 / 491 段 / 24098 项阻断」）。
 * 用户不可能知道「改了解析口径要手动重建」，这是一个**静默的不一致**。
 *
 * 规矩：**凡改动分集或正文识别口径（`episodeCapture` / `episodeHeadingOf` / `preludeOf` /
 * `isSceneHeading` / `headingKindOf` / 说话人与名册判定），必须 bump 此值** ——
 * 否则存档对账不触发，修复等于没交付。格式自由，改动即可。
 */
export const parserVersion = '2026-10-05.2';

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

/**
 * 分集标记行：第N集 / 第N话 / EP0N / Episode 0N，可后接标题。parser 与 episodes 共用同一口径。
 *
 * **允许 Markdown 井号前缀**（`### 第七集`）。老大《猫大夫的快乐处方》实测：集标写成 Markdown
 * 标题时行首是 `#`，旧口径只允许 `\s*`，于是**一个集标都识别不到** → `splitEpisodes` 退化为
 * 「整本单集」→ 界面显示「第01集」一集、491 段、24098 项阻断。
 *
 * 注意井号前缀与 `isSceneHeading` 的井号分支同形，所以 `parseScript` 里**集标判定必须先于场次判定**，
 * 否则「第七集」会冒充场次混进场次表。
 */
const episodeCapture = /^\s*(?:#{1,6}\s+)?(?:第\s*([0-9]{1,4}|[零一二三四五六七八九十百千两]{1,8})\s*[集话章]|(?:EP|EPISODE)\s*([0-9]{1,4}))\s*(?:[：:、.．\-—]\s*)?(.*)$/iu;

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
 * 集号清单行（附录索引 `EP31—EP60` / `EP19 / EP39 / EP52`）：是集标形态但不是集头。
 * `splitEpisodes` 判定「首个切点之前的原文」时据此剔除，避免把索引行当成第 1 集的集头。
 */
export function isEpisodeIndexHeading(line: string): boolean {
  const heading = episodeHeadingOf(line);
  return !!heading && heading.kind === 'preface' && episodeIndexTitle.test(heading.title);
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

/**
 * 非人名构词尾（**通用构词判据，不是样本词表**）。
 *
 * 汉语人名不会以这些字收尾 —— 它们统一是财务 / 单据 / 器物 / 数据 / 界面名词的词尾：
 * `订单` `库存` `总额` `金额` `账号` `密码` `照片` `屏幕` `文件` `款项` `数据` `档案`…
 *
 * 为什么需要它（2026-10-05 通用化）：`subjectStopwords` 只能枚举**某一部戏里出现过的**器物词
 * （`余额` / `总账` / `文件名` / `收件人`…），换一部戏就漏。实测一份虚构剧本：
 * `订单：2400 单待分配。` 被当成可信台词，`订单` 与 `库存` 双双写进人物名册。
 * 改成构词判据后，**任何**以这些字收尾的名词都被拒 —— 不依赖它是否曾在样本里出现过。
 * 这是「按构词规律判」而不是「按见过的词判」，所以对新剧本天然成立。
 */
const nonPersonNounTail = /(?:额|量|率|账|帐|单|号|码|证|照|片|卡|屏|盘|档|案|库|存|据|录|件|款|键|费|税|价|息|表)$/u;

/**
 * 数量尾（`路人若干` / `群演数名`）：描述「有多少人」而不是「是谁」，不是一个人物名。
 * 顿号名单（`人物：灰灰、路人若干`）按顿号切开后逐段登记，靠它把「若干」这类计数段挡在名册外。
 */
const countTail = /(?:若干|数名|余名|多名)$/u;

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
  if (nonPersonNounTail.test(name)) return false;
  if (countTail.test(name)) return false;
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
 * 值的形态不像「可说的话」：以数字 / 货币符号 / 数量短语开头。
 *
 * 依据（2026-10-05 通用化）：剧本里带全角冒号的叙述行，值绝大多数是账目与面板数字
 * （`余额：2,430。` / `订单：2400 单待分配。` / `库存：12 束白玫瑰。`），
 * 而台词极少以裸数字起头。命中则**暂判叙述** —— 由 `parseScript` 的第二遍扫描在说话人
 * 被确证后回填，所以 `苏清苒：3000 块我出。` 这类真台词不会被永久吞掉。
 *
 * 值缺失（空串）一律不算可疑：`speakerTrusted('苏清苒')` 这种只判标签的调用不得受影响。
 */
const numericValueLead = /^[\s¥￥$＄]*[+\-]?(?:[0-9０-９][0-9０-９,，.．]*|[一二三四五六七八九十百千万两]{1,3}[个件束单条名位次场集页块张支把遍元角分秒])/u;

export function looksNumericValue(value: string): boolean {
  const text = value.trim();
  return !!text && numericValueLead.test(text);
}

/**
 * 台词说话人是否可信（单一来源）：不可信的「标签：值」行是**叙述行**
 * （`余额：2,430。` / `门上贴着三个字：…` / `画面猛地拉开：一把军刀…`），
 * 必须按 action 处理 —— 既不得进 ⑫ 台词，也不得占用「确凿台词行」解屏正文块。
 *
 * `value` 传值部文本（可省）：凭空看标签分不清 `订单：…` 与 `王五：…`，看值才分得清 ——
 * 「值像账目数字」是比「标签像不像人名」更可靠的通用信号。已确证姓名（在 `cast` 里）
 * **无条件放行**，所以真台词写数字开头也不会被误降级。
 */
export function speakerTrusted(label: string, cast: string[] = [], value = ''): boolean {
  const stem = speakerNameOf(label);
  if (!stem) return false;
  if (cast.includes(stem)) return true;
  if (isCastName(stem)) return !looksNumericValue(value);
  if (locativeTail.test(stem)) return false;
  if (numberedRole.test(stem)) return true;
  return roleSpeaker.test(stem) && stem.length <= 6;
}

function isCastHeading(line: string): boolean {
  const parts = headingPartsOf(line);
  return !!parts && castHeadings.has(parts.label);
}

/**
 * 场次标题行（单一来源）—— 按**结构特征**判，不再枚举 6 种写法。
 *
 * 旧口径只认 `# 标题 / 第N场 / 场次N / 场景N / 内. / 外. / INT. / EXT.`，实战会漏：
 * 老大那边的真实稿写作 `7-1 城市广场 日 外`（集-场编号 + 时空标记），一个场次都认不出来，
 * 整集挤成一个「未标注场次」。
 *
 * 场次标题的通用特征是两件事之一：
 * ① **场次编号** —— `第N场` / `场次N` / `场景N` / `场面N` / `序场` / `过场` / `S01` / `SC01`；
 * ② **时空标记** —— 行内同时出现时间词（日/夜/黄昏…）与**独立成词**的「内」或「外」。
 * ② 必须成对出现，或配一个纯数字编号（`7-1` / `1.` / `1、`）—— 否则正文里「夜里」「外面」会误判。
 */
const sceneExplicit = /^\s*(?:#{1,6}\s+|INT\.|EXT\.)/iu;
const sceneNumbered = /^\s*(?:第[^\s]{0,6}场|(?:场次|场景|场面)\s*[0-9一二三四五六七八九十百千两]{1,4}|序场|过场|(?:SC|S)\s*[0-9]{1,3})/iu;
const sceneNumberPrefix = /^\s*[0-9]{1,2}\s*(?:[.．、]|[－\-—]\s*[0-9]{1,2})/u;
const sceneTimeMark = /(?:^|[\s/·、，,.()（）])(?:日|夜|晨|清晨|早上|上午|中午|午后|下午|傍晚|黄昏|凌晨|深夜)(?=$|[\s/·、，,.()（）])/u;
const scenePlaceMark = /(?:^|[\s/·、，,.()（）])(?:内|外)(?:景)?(?=$|[\s/·、，,.()（）])/u;

export function isSceneHeading(line: string): boolean {
  const text = line.trim();
  if (!text) return false;
  if (sceneExplicit.test(text) || sceneNumbered.test(text)) return true;
  if (!sceneTimeMark.test(text) || !scenePlaceMark.test(text)) return false;
  return sceneNumberPrefix.test(text) || text.length <= 12;
}

/** 确凿的正文台词行：说话人**可信**的 `说话人：内容`，或括号内的旁白 / 内心标记。 */
function isTrustedDialogueLine(line: string, cast: string[]): boolean {
  if (/^[(（]\s*(?:旁白|内心(?:OS)?|OS|心声|独白)/iu.test(line)) return true;
  const parts = headingPartsOf(line);
  return !!parts && !!parts.value && speakerTrusted(parts.raw, cast, parts.value);
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

// ── 前言区文档层判据（2026-10-05 通用化）────────────────────────────────────
//
// 为什么需要它：`briefHeadings` 是**老大定稿稿格式的契约表**（前言统计表、附录「补写说明」
// 的标签是固定的），但它**列不全别人剧本的写法**。实测一份虚构剧本：`作品信息` / `台词统计` /
// `出场人物` 三个不在表里的标题，把下属块整块泄漏成节拍。
//
// 通用做法不是继续往表里加词，而是**按位置 + 结构判** —— 正式剧本的**前言区**（首个集标之前）
// 按体裁必然是文档层。于是：那里出现的短标题，只要其下属块**整体是元数据形态**，就一并丢弃。
// 正文区一律不猜 —— 宁可不丢，不可错吞。

/**
 * 裸标题行：短、独立成行、不含取值分隔符 —— 文档层节标题长这样（`作品信息` / `台词统计`）。
 * 含数字（表格行 `沈砚 34`）、含空白、含 `，。：` 或长度 > 8 的行一律不算，
 * 所以正文的叙述句、台词与统计表行都不会被误当标题。
 */
function isBareHeadingLine(line: string): boolean {
  const text = line.trim();
  if (!text || text.length > 8) return false;
  if (/[0-9０-９]/u.test(text)) return false;
  if (/[，。！？；：:、,.!?;]/u.test(text)) return false;
  if (/[（(【\[]/u.test(text)) return false;
  if (/\s/u.test(text)) return false;
  return true;
}

/**
 * 元数据形态（结构判据，**不查词表**）：文档层的表格行与「短标签 + 短值」的 `标签：值` 行。
 *
 * 关键区分是**值不是句子** —— 文档层的值是短词组（`夜航西飞` / `12` / `90 秒`），
 * 正文的「标签：值」叙述行的值是句子（`门外传来脚步声：很轻。`）。据此把两者分开。
 */
function looksMetadataShaped(line: string): boolean {
  if (isMetadataLine(line)) return true;
  const text = line.trim();
  if (/[｜|]/u.test(text)) return true;
  const cells = text.split(/\s+/u).filter(Boolean);
  if (cells.length >= 2 && cells.some((cell) => /^[0-9０-９¥￥$]/u.test(cell))) return true;
  const parts = plainLabel.exec(text);
  if (!parts) return false;
  return parts[1].trim().length <= 6 && effectiveLength(parts[2].trim()) <= 12 && !/[。！？；]/u.test(parts[2]);
}

/** 像台词行（**不看值形态**）：块判据里用它当「解屏」条件 —— 宁可不丢，不可错吞。 */
function looksLikeDialogueLine(line: string, cast: string[]): boolean {
  if (/^[(（]\s*(?:旁白|内心(?:OS)?|OS|心声|独白)/iu.test(line)) return true;
  const parts = headingPartsOf(line);
  return !!parts && !!parts.value && speakerTrusted(parts.raw, cast, '');
}

/**
 * 从 `from` 起的块若**整体是文档层形态**，返回块结束行号（含）；否则返回 -1。
 * 任一行不是元数据形态、或是集标 / 场次标题 / 台词行 → 立即否决。
 * 空行终止块（文档层块是连续排布的）。
 */
function documentBlockEnd(lines: string[], from: number, cast: string[]): number {
  let counted = 0;
  let last = from - 1;
  for (let i = from; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) break;
    // 下一个裸标题行另起一块：当前块到此为止（`作品信息` 与紧邻的 `台词统计` 是两块，不是一块）。
    if (isBareHeadingLine(trimmed)) break;
    if (isEpisodeMarker(trimmed) || isSceneHeading(trimmed) || looksLikeDialogueLine(trimmed, cast)) break;
    if (!looksMetadataShaped(trimmed)) return -1;
    counted += 1;
    last = i;
  }
  return counted >= 2 ? last : -1;
}

/**
 * 顿号名单行：`人物：灰灰、路人若干` —— 值是**专名清单**，不是一句话。
 *
 * 这是残留发现项②的根因：`人物` 两字通过了 `isCastName`，于是整行被当台词，「人物」进名册。
 * 判据不看标题词（`人物` / `出场` / `角色` 都行），只看**值的形态**：含顿号，且按顿号切开后
 * **每一段都像一个人物名**（或命中角色称谓）。台词里极少出现「整句由专名顿号串联、毫无谓语」的情形。
 */
function rosterNamesOf(line: string): string[] | null {
  const parts = plainLabel.exec(line.trim());
  if (!parts) return null;
  const value = parts[2].trim();
  if (!value.includes('、')) return null;
  const tokens = value.split(/[、，,]/u).map((token) => token.trim()).filter(Boolean);
  if (tokens.length < 2) return null;
  return tokens.every((token) => isCastName(token) || (roleSpeaker.test(token) && token.length <= 6)) ? tokens : null;
}/**
 * 前言区人物表块（结构判据，**不查标题词表**）：块内非空行 ≥2 行、**逐行**都是
 * 「短词 + 分隔符 + 描述」形态，且短词过 `isCastName` → 返回块结束行；否则 -1。
 *
 * 与 `documentBlockEnd` 的分工：人物表块的值是**名词性描述**（`28 岁，夜班调度员`），
 * 不是元数据；所以两条通道并存。任一行含句末标点（`。！？`）即否决 —— 那是句子，
 * 不是人物条目；宁可漏认（姓名还能从台词里补上），不可错吞台词。
 */
function castBlockEnd(lines: string[], from: number, cast: string[]): number {
  let counted = 0;
  let last = from - 1;
  for (let i = from; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) break;
    if (isBareHeadingLine(trimmed) || isEpisodeMarker(trimmed) || isSceneHeading(trimmed)) break;
    if (looksLikeDialogueLine(trimmed, cast) && !castEntry.test(trimmed)) break;
    if (/[。！？]/u.test(trimmed)) return -1;
    const match = castEntry.exec(trimmed);
    if (!match || !isCastName(match[1].trim())) return -1;
    // 「沈砚 34」是**统计表行**（描述部是裸数字），不是人物条目 —— 交给 `documentBlockEnd` 当元数据处理。
    if (/^[0-9０-９][0-9０-９\s]*(?:字|句|个|条|次|%|％)?$/u.test(trimmed.slice(match[0].length).trim())) return -1;
    counted += 1;
    last = i;
  }
  return counted >= 2 ? last : -1;
}

export function parseScript(text: string): ScriptStructure {
  const scenes: Scene[] = [];
  const beats: Beat[] = [];
  const cast: string[] = [];
  /**
   * 待定台词行：「像人名、且值以数字/数量开头」因而被暂判叙述的行。
   * 整篇扫完后（名册已攒齐）第二遍判定 —— 说话人若已确证就回填为台词。
   * 之所以要第二遍：`订单：2400 单待分配。` 与 `苏清苒：3000 块我出。` 在**第一遍**长得一样，
   * 只有等名册攒齐才分得开。
   */
  const pending: { index: number; raw: string; value: string; valueStart: number }[] = [];
  let cursor = 0;
  let currentScene: Scene | undefined;
  let skip: 'none' | 'cast' | 'other' = 'none';
  const lines = text.split('\n');
  /**
   * 前言区标记：`true` = 尚未遇到本集文本里的第一个集标。
   *
   * 只在**整篇确实有集标**时启用 —— 一本连集标都没有的稿子，我们没有判断「哪一段是前言」的
   * 依据，此时按老口径逐行走（`EPISODE_SPLIT_UNVERIFIED` 闸门已会提示人工核对切点）。
   */
  let preface = lines.some(isEpisodeMarker);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const start = cursor + line.indexOf(trimmed);
    const end = start + trimmed.length;
    cursor += line.length + 1;
    if (!trimmed) continue;
    if (isEpisodeMarker(trimmed)) preface = false;

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

    /**
     * 集标行先于场次判定：`### 第七集` 同时满足 `isSceneHeading` 的井号分支，
     * 若排在它后面，集标会冒充场次混进场次表（实测 `scenes.title = '第七集'`）。
     */
    if (isEpisodeMarker(trimmed)) continue;

    if (isSceneHeading(trimmed)) {
      if (currentScene) currentScene.range.end = start;
      currentScene = { id: `scene-${scenes.length + 1}`, title: trimmed.replace(/^#+\s*/, ''), range: { start, end: text.length } };
      scenes.push(currentScene);
      continue;
    }
    // 场次判完再判元数据：集头九字段、幕标记、CUT TO 等制作层内容不进节拍。
    if (isMetadataLine(trimmed)) continue;

    /**
     * 前言区文档层块（分区 + 结构判据）：标题与下属块整体丢弃。
     * 这里用**跳行**而不是 `skip` 态 —— 块的确切结束行已经算出来了，不必再让「解屏」去兜。
     *
     * 两条通道先判人物表：它是**前言区最该被认出**的一块（认不出就会丢人物名册，
     * 实测一份虚构剧本里主要人物 `林可` 因标题写作 `出场人物` 而整条没进名册）。
     */
    if (preface && isBareHeadingLine(trimmed)) {
      const rosterEnd = castBlockEnd(lines, index + 1, cast);
      if (rosterEnd > index) {
        for (let i = index + 1; i <= rosterEnd; i += 1) { castNamesOf(lines[i], cast); cursor += lines[i].length + 1; }
        index = rosterEnd;
        continue;
      }
      const blockEnd = documentBlockEnd(lines, index + 1, cast);
      if (blockEnd > index) {
        for (let i = index + 1; i <= blockEnd; i += 1) cursor += lines[i].length + 1;
        index = blockEnd;
        continue;
      }
    }

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
      /**
       * 顿号名单行（`人物：灰灰、路人若干`）：值是**专名清单** → 逐个登记姓名，绝不当台词。
       * 前言区里整行不进节拍（它本来就是文档层）；正文区保守 —— 仍按叙述保留原文，一个字不丢。
       */
      const roster = rosterNamesOf(trimmed);
      if (roster) {
        // 名单**形态**成立即整行不是台词；但只有真正像人名的段才进名册（`路人若干` 是计数，不是人）。
        roster.filter(isCastName).forEach((name) => { if (!cast.includes(name)) cast.push(name); });
        if (preface) continue;
        addBeat();
        continue;
      }
      const normalized = label.replace(/[\s._-]/gu, '').toLowerCase();
      const kind: DialogueFragment['kind'] = /旁白|narration|voiceover|vo/u.test(normalized) ? 'narration' : /内心|os|心声|独白/u.test(normalized) ? 'inner' : 'dialogue';
      // 说话人不可信（`余额：2,430。` / `门上贴着三个字：…` 这类叙述行含全角冒号）→ 按叙述处理。
      if (kind === 'dialogue' && !speakerTrusted(label, cast, match[2])) {
        // 唯一不确定的一类：**标签像人名、只是值以数字开头**。先按叙述落拍并记下标，交给第二遍。
        const stem = speakerNameOf(label);
        if (stem && isCastName(stem) && looksNumericValue(match[2])) {
          pending.push({ index: beats.length, raw: label, value: match[2], valueStart: start + trimmed.length - match[2].length });
        }
        addBeat();
        continue;
      }
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

  /**
   * 第二遍：回填「值看似账目、因而被暂判叙述」的待定行 —— 说话人此刻**已被确证**
   * （进了名册，或命中角色称谓 / 角色+天干）就恢复为台词。
   *
   * 这一步只可能救回、不会误伤：第一遍能认的都已认下，这里仅处置「当时分不清」的那一小撮。
   * 倒序替换 —— 只有更靠后的下标被改动，先前记下的下标依然有效。
   */
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const item = pending[i];
    const stem = speakerNameOf(item.raw);
    if (!cast.includes(stem) && !numberedRole.test(stem) && !(roleSpeaker.test(stem) && stem.length <= 6)) continue;
    const scene = beats[item.index]?.sceneId;
    if (!scene) continue;
    const restored: Beat[] = splitDialogue(item.raw, item.value, item.valueStart, 'dialogue').map((dialogue) => ({
      id: '', sceneId: scene, kind: 'dialogue', text: dialogue.text, range: dialogue.range, dialogue,
    }));
    beats.splice(item.index, 1, ...restored);
  }
  // 回填会改变节拍数量，统一重排 id（`beat-N` 只在本集内唯一，与既有口径一致）。
  beats.forEach((beat, index) => { beat.id = `beat-${index + 1}`; });

  return { scenes, beats, cast };
}
