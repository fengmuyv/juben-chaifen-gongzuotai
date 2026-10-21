---
name: minimax-h3-video-prompt
display_name: MiniMax H3 提示词体系（v2.1 · 三段式 × API字段 × Ref2VA × 文戏/武戏双类型）
description: AI 漫剧体系 MiniMax H3（开放通用多模态视频模型 / 海螺 H3）提示词编写体系 v2.1.0，融合官方 h3-prompt-writing 字段式、飞书手册三段式与 MiniMax 专属文戏/武戏完整模板。覆盖五大范式：A-Hub 自然语言三段式（参考素材说明+核心创意+画面过程说明）、B-API 结构化字段式（integrated_multimodal_description+overall_soundscape+non_diegetic_music，T2VA/I2VA/FL2VA/L2VA）、C-全参考 Ref2VA 六段式（subject_definitions→…→non_diegetic_music）、D-文戏对话单元（10–15秒·Subject/Picture/S绑定·声线锁定·台词预算·画外音三行格式）、E-武戏动作导演（15秒高密度动作·阵型/武器判断/战斗载体路由/逐秒结构/物理反馈）。文戏与武戏类型互斥防污染。当用户提到 MiniMax H3 / 海螺 H3 / H3 模型 / H3 提示词 / H3 视频 / H3 图生视频 / H3 多模态 / H3 API / H3 SDK / 用 H3 生成 / 海螺视频 / 参考素材说明 / 核心创意 / 画面过程说明 / integrated_multimodal_description / Ref2VA / @图片1 / 锁脸锁动作 / 音频复用 / MiniMax Design / MiniMax 文戏 / MiniMax 武戏 / 声线锁定 / 台词预算 / 画外音单元 / H3 动作戏时自动调用，先判「文戏/武戏/通用」类型轴，再按「是否上传素材 + 输出形态」路由到对应范式。
version: 2.1.0
author: WorkBuddy 体系化包（融合官方 h3-prompt-writing + 飞书手册 v1.1.0 + MiniMax 文戏/武戏模板 2026-09-07）
tags: ["AI漫剧","MiniMax H3","海螺","视频提示词","多模态视频","图生视频","提示词公式","API字段式","全参考Ref2VA","风格goodcase","负向约束","文戏","武戏","对话单元","声线锁定","动作导演"]
trigger_keywords: ["MiniMax H3","minimax","H3 模型","H3 提示词","H3 视频","H3 图生视频","H3 多模态","海螺 H3","海螺视频","参考素材说明","核心创意","画面过程说明","用 H3 生成","H3 prompt","H3 分镜","H3 公式","MiniMax Hub","MiniMax Design","H3 API","H3 SDK","integrated_multimodal_description","overall_soundscape","non_diegetic_music","Ref2VA","@图片1","锁脸","锁动作","音频复用","subject_definitions","MiniMax 文戏","MiniMax 武戏","H3 文戏","H3 武戏","文戏单元","武戏提示词","动作戏提示词","声线锁定","画外音","台词预算","阵型A","阵型B","战斗载体"]
global_enable: true
category: "AI漫剧体系·MiniMax H3"
layer: "L3·MiniMax H3 视频提示词"
paradigms: ["A-Hub三段式","B-API字段式","C-全参考Ref2VA","D-文戏对话单元","E-武戏动作导演"]
scenario_route: "见正文 §〇 路由决策（先判类型轴，再判输出范式）"
---

## Framewright v4.1.1 融合指针（MiniMax H3 类型内）

沿用本技能“文戏/武戏/通用→范式 A-E”双轴，仅补 target routing、reference role 与 audio contract。不得引入 Seedance runtime profile；文戏和武戏继续互斥，Framewright 不成为独立触发入口。

# MiniMax H3 提示词体系（v2.1.0 · 三段式 × API字段式 × Ref2VA × 文戏/武戏）

> **融合声明**：本体系 v2.1 由四份权威源融合迭代而来——
> ① 飞书《🐚MiniMax H3 模型 - 使用手册》（2026-08-11）的「提示词」章节，即本地 v1.1.0 的中文三段式（范式 A）；
> ② 官方开源 `MiniMax-AI/MiniMax-H3` 仓库的 `h3-prompt-writing` skill（英文结构化字段格式），即范式 B / 范式 C；
> ③ 《MiniMax 文戏完整提示词模板》（2026-09-07 用户提供，MiniMax 专属）→ 范式 D（文戏对话单元）；
> ④ 《MiniMax 武戏完整提示词模板》（2026-09-07 用户提供，MiniMax 专属）→ 范式 E（武戏动作导演）。
> ①②是**互补的两种输出范式**（Hub 对话自由文本 ↔ API 结构化字段）；③④是**互斥的两种内容类型**（文戏 ↔ 武戏，防污染隔离），合为五范式双轴体系。
> **完整提取副本（①的母本）**：原 `E:\仓库\ai漫剧\Minimax_H3_提示词编写手册_20260827.md` 已归档缺失（2026-09-03 物理重组时复核为历史悬空引用）；最接近的留存 = `E:\仓库\ai漫剧\03_技能体系\_技能备份\_skill_backup_20260828\minimax-h3-video-prompt\references\`（v1.x 参考副本）。
> **官方英文保真稿（②）**：`references/08_official_base-en.txt`（基础模式）、`references/09_official_ref-en.txt`（全参考模式）。
> **中文综合（②的落地版）**：`references/06_API字段范式与全参考Ref2VA.md`。
> **体系集成定位**：挂 `ai-manhua-system` 拓扑 L3·MiniMax H3 视频提示词，与 L3a 一镜到底 / L3b 通用分镜（均 Seedance 方言）并列，是 H3 模型专用提示词方言。
> **标注规则**：【手册原文】= 来自飞书手册；【官方原文】= 来自官方 h3-prompt-writing；【体系融合/扩展】= 本 v2.0 适配 AI 漫剧工作流的补充，非任一原文，可独立取舍。

---

## 〇、路由决策（先判类型轴，再判输出范式）

收到 H3 相关请求后，**第一轴先判内容类型（文戏/武戏/通用），第二轴再判输出范式**。命中即自动调用对应范式的内容与参考文件。

```
用户请求
│
├─ 第一轴·内容类型（先判）
│   ├─ 文戏/对话戏/有台词单元/声线锁定/双人对话/画外音 → 范式 D（文戏对话单元）
│   │       读 references/10 —— 类型内禁用 E 的动作语法（见 §八防污染）
│   ├─ 武戏/动作戏/打斗/战斗/高密度动作 → 范式 E（武戏动作导演）
│   │       读 references/11 —— 类型内禁用 D 的台词体系（见 §八防污染）
│   │       （走打戏全流程[素材→路线→A稿→平台B稿]时改路由 design-fight-videos，本范式管单条直出）
│   └─ 通用/风格类/不涉及文武类型 → 进第二轴（A/B/C）
│
└─ 第二轴·输出范式（通用类型再判）
    ├─ 是否在 MiniMax Hub / 对话式里要「中文自由文本」提示词？
    │   └─ 是 → 范式 A（Hub 三段式）：参考素材说明 + 核心创意 + 画面过程说明
    │           读 references/01 02 03 04 05 07
    │
    ├─ 是否走 H3 API / SDK / 程序化生成，需要「结构化字段」输出？
    │   └─ 是 → 范式 B（API 字段式）：integrated_multimodal_description + overall_soundscape + non_diegetic_music
    │           读 references/06（综合） / 08（官方原文）
    │
    └─ 是否上传了图/视频/音频素材，且要求「精确引用与复用」（锁脸/锁动作/锁场景/音频复用/Ref2VA）？
        └─ 是 → 范式 C（全参考 Ref2VA 六段式）：subject_definitions→summary→retention_analysis→detailed_description→overall_soundscape→non_diegetic_music
                读 references/06（综合） / 09（官方原文）
```

**自动匹配要点**：
- 用户说"用 H3 生成 / 海螺视频 / H3 图生视频 / 多模态融合 / 参考素材说明 / 核心创意 / 画面过程说明"→ 触发本 skill，先过第一轴。
- 用户说"文戏 / 对话 / 台词单元 / 声线 / 画外音 / 双人对话 10–15 秒"→ 范式 D；说"武戏 / 打斗 / 动作 / 战斗 15 秒"→ 范式 E（若用户同时要文戏单元和武戏场面，按单元拆开分别走 D/E，不在一条提示词里混写）。
- 检测到用户**上传了素材且要逐条写清用途**（锁脸/锁动作/锁场景/音频复用）且属通用类型 → 优先范式 C（Ref2VA 的 `<Subject N>`/`<Picture N>`/`<Audio N>` 标签比三段式的 `@图片1` 更精确）；范式 D 的标签体系与之同源，D 需精确复用时可叠加 C 的标签纪律。
- 检测到用户要**投 H3 API/SDK 的程序化字段** → 范式 B。
- 其余 Hub 对话式中文需求 → 范式 A。
- 同一请求常跨范式：例如"在 Hub 里用三段式写，但导出成 API 字段"→ 先 A 后 B 转译（见 §七）；"文戏单元 + 需精确引用复用"→ D 为主、叠加 C 的标签纪律。

---

## 一、何时使用 / 触发场景

- 用户要写 **MiniMax H3** 视频提示词（文生 / 图生 / 多模态参考 / API 字段 / 全参考复用）；
- 用户上传了图片 / 视频 / 音频素材，要写清每个素材在 H3 里的用途（锁脸 / 锁动作 / 锁场景 / 关键帧 / 音色参考 / 音频复用 / 视频编辑）；
- 用户要求"用 H3 生成""海螺视频""H3 图生视频""多模态融合""导出 H3 API 字段""Ref2VA 复用"；
- 需要 H3 专属的**跨 shot 台词（J-cut/L-cut）**、**切镜一致性**写法；
- 需要大字幕 MV / 手绘特效 等 H3 风格 goodcase 的提示词；
- 用户提到 MiniMax Hub / MiniMax Design / H3 API / H3 SDK 自动写提示词；
- **文戏**：要把小说/剧本/对白拆成 H3 10–15 秒对话单元（单人/双人、声线锁定、画外音、台词预算），或从一张人物图/双人合照推演剧情台词；
- **武戏**：要从参考图+设定直出一条 H3 15 秒高密度动作提示词（阵型、武器/能力判断、战斗载体、逐秒结构、物理反馈）。

---

## 二、范式总览（双轴五范式体系）

本体系按两个正交轴组织：**类型轴**（文戏 D / 武戏 E / 通用 A·B·C）× **输出范式轴**（Hub 自由文本 / API 字段 / Ref2VA 六段式 / 文戏单元模板 / 武戏导演模板）。

| 范式 | 名称 | 输出形态 | 权威源 | 适用场景 | 核心字段/结构 |
|---|---|---|---|---|---|
| A | Hub 三段式 | 中文自由文本 | 飞书手册 | Hub 对话式、要自然语言 | 参考素材说明 + 核心创意 + 画面过程说明（`@图片1`） |
| B | API 字段式 | 结构化英文字段 | 官方 h3-prompt-writing | H3 API/SDK、程序化生成 | `integrated_multimodal_description` + `overall_soundscape` + `non_diegetic_music` |
| C | 全参考 Ref2VA | 结构化六段（英） | 官方 h3-prompt-writing | 上传素材且需精确引用复用 | `subject_definitions`→`summary`→`retention_analysis`→`detailed_description`→`overall_soundscape`→`non_diegetic_music` |
| **D** | **文戏对话单元** | 中文单元模板（Subject/Picture/S 标签） | MiniMax 文戏模板（2026-09-07 用户入库） | 文戏：10–15 秒对话单元、剧本流/单图流、声线锁定、画外音 | 填写规则 + 生成前引导（单元切分/台词预算/Shot 密度）+ 单人/双人模板 + 画外音/功能人声/轻喜剧/拥抱亲吻替换块 + 固定尾部 + 交付检查 |
| **E** | **武戏动作导演** | 中文成段提示词（1800–3000 字） | MiniMax 武戏模板（2026-09-07 用户入库） | 武戏：15 秒高密度动作直出、阵型 A/B、参考图+设定 | 用户输入表 + 信息优先级 + 参考图识别 + 武器/能力判断 + 战斗载体路由 + 攻防适配 + 逐秒五段结构 + 物理反馈 + 全局禁止项 |

**共享子模块（A/B/C 通用）**：运镜三维度词汇（§四·1）、对白 `<d>` 与跨 shot J/L-cut（§四·2）、负向约束（§六）、风格 goodcase（§六）。
**类型专属子模块（D/E 各自独占，互不引用，见 §八防污染铁律）**：D 的台词预算/声线锁定/画外音体系；E 的战斗载体路由/物理反馈/逐秒结构。

---

## 三、范式 A：Hub 自然语言三段式【手册原文】

> 完整子项、示例、音频复刻歌词写法见 `references/01_公式与四要素.md`；镜头拆解见 `references/02_三类模式与镜头拆解.md`。

### 3.1 整体公式
```
完整提示词 = 参考素材说明 + 核心创意 + 画面过程说明
```

### 3.2 参考素材说明
告诉 H3 你上传的每个素材是干什么用的。
- 写清素材编号：按上传顺序 `@图片1` `@音频2` `@视频3`
- 写清每个素材的用途：人物参考（锁脸/形象）/ 物体参考（锁物体） / 场景参考（锁场景）/ 关键帧（锁帧，首帧尾帧需求明确提出） / 音色参考（锁音色）/ 故事版 / 风格参考 / 构图参考 / 音频复用（生成视频的音频直接复用参考音频素材）/ 音频部分复用 / 动作参考（锁动作）/ 运镜参考（锁运镜）/ 视频编辑（增删改），以及其他要求也可按需写明。
- 没有上传素材时整段跳过。

### 3.3 核心创意
用一句话锁定全片信息，**必须包含**：主体（谁/什么）/ 地点（在哪里）/ 事件（在做什么）/ 题材·风格（写实/动画/电影感/广告片/纪录片…，特殊如赛博朋克/霓虹灯美学/涂鸦风）/ 特殊运镜（航拍/一镜到底/慢动作…，默认会切镜；环绕运镜建议 `truck left+pan right` 或 `truck right+pan left`；切镜风格：普通切镜 cut / 叠化 fade / 卡点切 / 快切）。任何与引用素材的关联用 `@图片1` 等强调。

### 3.4 画面过程说明
按时间轴/故事线分段写，每个分镜/时间段含两部分：**想要**（画面景别+内容+运镜+动作+台词+音效，以切镜 shot 为时间戳分段；台词长短尽量和镜头长短对齐；跨 shot 台词用"接着上个 shot 继续说"；需出现的文字/Logo/标题必须写原文）+ **不想要**（如不要 BGM 写 `非叙事性音乐：N/A` 或 `"non_diegetic_music": N/A`）。
- **尽量少写比喻句，多写看得见的画面**：H3 更擅长理解明确的画面指令，不是抽象比喻。
- **如有台词，必须明确具体内容**。

### 3.5 三类模式【手册原文 · 1.4】
- **多模态素材融合**：同时传 人物图+动作视频+场景图+音乐，每个素材写清角色（`@图片1→人物参考(锁脸)` `@视频1→动作参考` `@音频1→节奏/情绪参考`）
- **图生视频**：1 张图说清首帧/尾帧；2 张图(首+尾) H3 不自动加切镜，只补两帧间动作光影声音
- **纯文字生成视频**：不依赖素材，文字更具体（主体外观/场景细节/动作全写清）；用「大全景交代空间+中景承载动作+特写强调细节」分层写法

---

## 四、范式 B：API 结构化字段式【官方原文 · h3-prompt-writing】

> 中文综合 + 逐字段示例见 `references/06_API字段范式与全参考Ref2VA.md`；英文保真稿见 `references/08_official_base-en.txt`。
> **总时长必须匹配目标视频长度（4–15 秒）**；参考标签全程一致；优先具体视听细节，少用"cinematic/beautiful"等抽象词。

### 4.1 四种基础模式
- **T2VA**：纯文本构建完整视听时间线，无对齐指令，直接以三段核心字段开头。
- **I2VA**：首帧图向前发展。对齐指令固定为首行：`For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`
- **FL2VA**：首帧↔末帧间连续路径。对齐指令：`How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.`（S.SS 为精确两位小数的有效时长）
- **L2VA**：反推合理开头收敛到末帧。对齐指令：`How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.`

对齐指令必须是最终提示词首行，其后空一行再接核心字段。

### 4.2 三段核心字段（顺序固定）
```text
integrated_multimodal_description: [Shot 1] ...   # 视觉/动作/镜头/说话人/对白/歌声/画内音，沿时间线
overall_soundscape: ...                            # 环境音+物理动作音+非语言人声（1–4 句）
non_diegetic_music: ...                            # 仅观众可听的背景乐（1–3 句，不含情绪词）
```
- `integrated_multimodal_description`：主体，沿时间线描述一切可见/可听细节（风格、初始构图、主体外观与位置、场景与关键道具、动作与反应、切镜、语言、同步画内音）。`[Shot 1]` 无时间戳；后续 `[Shot N] At MM:SS.mmm, the camera cuts to...`，切点严格递增且在时长内。
- `overall_soundscape`：1–4 句一段，汇总全片环境音、物理动作音、非语言人声（风/雨/交通/脚步/布料/撞击/呼吸/笑/喘）。对白/歌声/画内乐已在主描述，不重复。全程静音才用 `N/A`。
- `non_diegetic_music`：1–3 句描述仅观众可听的背景乐，聚焦乐器/速度/节奏/力度变化，不用抽象情绪词；无则 `N/A`。

### 4.3 共享规则（与范式 A 互通）
- **运镜三维度**（类型+幅度+速度）写成自然英文动作句，而非句尾堆叠标签：
  | 类型 | 幅度 | 速度 |
  |---|---|---|
  | Zoom In/Out, Push In/Pull Out, Pan Left/Right, Truck Left/Right, Tilt Up/Down, Pedestal Up/Down, Arc Shot, Tracking Shot, Static Shot, Shake Slightly/Strongly, POV, Roll CW/CCW | with small/large amplitude | at slow/fast speed |
  `The camera pushes in with small amplitude at slow speed toward the folded letter.`
- **说话人/对白**：稳定 ID `(S1)(S2)`，多人合说 `(S1,S2)`；对白 `<d>[语言] 原文</d>` 逐字保留；画外音 `says in an off-screen voiceover` 并注明"嘴唇不动"；跨剪辑 `<scenetrans>` + 注明音频连续；被截断 `<cutoff>`。
- **屏幕文字**：原样用英文双引号包裹（如 `a red neon sign reading "营业中"`）。

---

## 五、范式 C：全参考 Ref2VA 六段式【官方原文 · h3-prompt-writing】

> 中文综合见 `references/06_API字段范式与全参考Ref2VA.md`；英文保真稿见 `references/09_official_ref-en.txt`。
> 用于：上传图/视频/音频素材，且要求**精确引用与复用**（锁脸/锁动作/锁场景/音频复用/整视频结构）。

### 5.1 六段顺序（固定）
`subject_definitions` → `summary` → `retention_analysis` → `detailed_description` → `overall_soundscape` → `non_diegetic_music`

### 5.2 四类参考标签（定义后全段含义一致）
- `<Subject N>`：可复用的可见内容（人/物/景/风格/动作/表情/姿势）。
- `<Picture N>`：作为首/末/关键帧或分镜锚点的参考图。
- `<Video N>`：整视频关系（编辑源 / 续写起点 / 时间结构）。
- `<Audio N>`：被复制或引用的音频信号（可复用整段 / 部分 / 音色 / 歌词 / 音效 / 节拍）。

### 5.3 summary 任务类型前缀（可 `+` 组合，不重复）
`[keyframe completion]` / `[reference generation]` / `[video editing]` / `[video continuation]` / `[audio reuse]` / `[audio reference]`
例：`[video continuation + keyframe completion]`、`[video editing + audio reuse]`。

### 5.4 retention_analysis 关系标记
- 可见内容：`fully_preserved` / `partially_preserved` / `attribute_transfer` / `weak_reference`
- 音频：`fully_copy` / `partially_copy` / `reference` / `weak_reference`
每条标签一行，保留 `subject_definitions` 中确立的含义。

### 5.5 detailed_description
正文英文；风格在 `[Shot 1]` 前用一两句确立；通常 350–500 英文词（对白密集优先铺满台词时间线）。`<Subject N>` 标识参考主体，`(Sx)` 标识实际说话人；纯复用 BGM 中人声线索用 `<Audio N>`，不另造 `(Sx)`。

---

## 五·D、范式 D：文戏对话单元（10–15 秒）【文戏模板原文 · 2026-09-07 入库】

> 完整填写规则、生成前引导、全部模板与替换块见 `references/10_文戏对话单元范式.md`（唯一正本）。

### D.1 定位
MiniMax H3 专属**文戏**范式：把小说/剧本/对白切成 10–15 秒单元（剧本流），或从一张人物图/双人合照推演剧情台词（单图流），输出带角色绑定、声线锁定与台词的高完成度提示词。

### D.2 核心机制（速览，细则以 references/10 为准）
- **角色绑定**：`<Subject1>` 绑 `<Picture 1>`（双人同图共用 Picture1 靠左右位置区分；独立参考图分绑 Picture1/2）；场景用下一个 Subject 编号；人名 `Xiao Chen` 格式；主要说话人最多 S1/S2。
- **声线锁定**：每角色一段固定声线描述（音域/音色/语速/句尾/情绪变化 + 禁止风格），逐单元复用。
- **台词预算**：10秒20–28字 / 12秒28–36字 / 15秒36–44字；48字硬上限；<24字先做相邻合并检查。
- **Shot 密度**：10秒2–3镜 / 12秒3–4镜 / 15秒3–5镜；每单元一条主动作链、一次微型关系变化。
- **画外音**：仅限两人及以上已绑定场景、仅已绑定角色、固定三行格式；单人场景改画内低声自语；一次性功能人声限一句≤20字。
- **固定尾部**：【禁止项】+【强制声明】逐字保留。
- 标签体系与范式 C 同源（`<Subject N>`/`<Picture N>`/`<d>`），可叠加 C 的精确复用纪律。

## 五·E、范式 E：武戏动作导演（15 秒）【武戏模板原文 · 2026-09-07 入库】

> 完整用户输入表、十三节规则与静默自检见 `references/11_武戏动作导演范式.md`（唯一正本）。

### E.1 定位
MiniMax H3 专属**武戏**范式：以"电影级动作导演+武术指导"角色提示词，从参考图+补充设定直出一条 15 秒高密度动作视频提示词（约 1800–3000 字，结构化七段：总述 + 0-3/3-6/6-10/10-13/13-15 秒 + 声音与禁止项）。开头先输出 `BUNNY` 一词（源模板行为，保留勿删）。

### E.2 核心机制（速览，细则以 references/11 为准）
- **信息优先级**：用户明确指定 > 参考图可见事实 > 已确认角色战斗习惯 > 最小连续性补全 > 导演原创。
- **武器/能力铁律**：图里没有且用户没指定的武器一律不加（职业称号≠装备事实）；能力三条件（用户指定/图可见/版本确认）缺一即禁。
- **战斗载体自动路由**：刃器/长柄/钝器/远程/徒手/能力型/飞行生物/多足生物/机械载具九类，各走各的语法。
- **逐秒五段结构**：零前摇开战→高度轴线→追击与攻守逆转→封锁折返反击→三拍终结；每段继承上一段至少四项状态。
- **物理反馈**：每次接触必有受力、位移、结果；环境破坏符合材质与受力方向。
- **边界**：默认无对白无旁白；走打戏全流程（素材→路线→A稿→平台B稿）时改路由 `design-fight-videos`，本范式管 MiniMax 单条直出。

## 六、负向约束【手册原文归纳 + 官方原文】

- **不要背景音乐**：提示词末写 `非叙事性音乐：N/A` 或 `"non_diegetic_music": N/A`，并"不要额外添加背景音乐"。
- **不要字幕 / 标志 / logo**：明确写"禁止字幕、标志、背景音乐"；如需画面出现具体文字必须写原文。
- **不要抽象比喻**：用具体、直接、可视化描述替代"意会"句子。
- 风格专属禁止项（大字幕 MV 不用淡入淡出/柔和转场/全身镜头/多人全景；手绘特效禁 3DCG/恐怖怪物化等）见 `references/03` `references/04` 的「整体要求补充 / 禁止项」。
- 插拔式 negative 模块见 `references/05_负向约束与对照表.md`。

---

## 七、范式间对照与转译【体系融合 · 非原文】

- **A ↔ B 字段映射**：A 的「参考素材说明」≈ B 的对齐指令 + `<Picture/Subject/Audio N>`；A 的「核心创意」→ B 的 `[Shot 1]` 风格/主体/运镜开篇；A 的「画面过程说明」→ B 的 `integrated_multimodal_description` 逐 shot。Hub 三段式是给模型读的"自然语言"，API 字段式是给接口读的"结构化"，**同一创意可双向转译**。
- **B ↔ C 标签**：C 的 `<Picture 1>`/`<Subject N>`/`<Audio N>` 比 A 的 `@图片1` 更精确，凡需逐条引用复用一律升 C。
- **D ↔ C 标签同源**：范式 D 的 `<Subject N>`/`<Picture N>`/`<d>[Chinese]` 与 C 的标签体系同源；文戏单元需精确素材复用时，在 D 模板内叠加 C 的标签纪律，不重写 D 的切分逻辑。
- **D ↔ E 互斥不转译**：文戏与武戏是内容类型差异，不是格式差异，**不互相转译**；同一剧情既有文戏又有武戏时，按单元/场面拆开分别落 D/E 提示词。
- **D/E ↔ A/B/C**：D 的单元模板可视为"范式 A 画面过程说明"在文戏场景的专精形态；E 的七段成稿是"范式 A 中文自由文本"在武戏场景的专精形态——格式纪律以各自正本为准，不反向套用。
- **H3 ↔ Seedance**：跨模型（Seedance 13 项字段 ↔ H3 三段式）转译见 `references/07_H3vsSeedance对照表.md`（体系扩展·非手册原文）。

---

## 八、类型防污染铁律与体系关系（体系扩展）

### 8.1 文戏/武戏防污染铁律（2026-09-07 确立，强制）

文戏（范式 D）与武戏（范式 E）**类型互斥、模块隔离**，写任一类型的提示词时禁止引入对方专属规则：

| 隔离项 | 文戏（D）专属，武戏禁用 | 武戏（E）专属，文戏禁用 |
|---|---|---|
| 时间结构 | — | 逐秒五段（0-3/3-6/6-10/10-13/13-15 秒）+ 终结三拍 |
| 台词体系 | 台词预算表、声线锁定块、画外音三行格式、一次性功能人声、单元切分合并检查 | —（默认无对白；仅用户逐字提供时原样嵌入，不加声线块） |
| 输入框架 | 信息四分类（画内台词/OS/功能人声/后期文字） | 阵型 A/B 表、信息优先级五级、胜负结果三件套 |
| 动作语法 | 动作只服务对话，Shot 密度 2–5 镜 | 战斗载体九类路由、攻防适配六情形、物理反馈与环境破坏体系 |
| 角色绑定 | Subject/Picture/S 标签模板正文 | —（参考图靠文字描述锁定；需 Ref2VA 标签另叠加范式 C） |

执行纪律：**一次只加载一个类型的参考正本**（references/10 或 references/11），路由命中哪个类型就只按哪个正本写作；共享的只有人名格式、参考图身份锁定原则与"禁可读文字"负向思路（各自表述，不互相引用）。

### 8.2 与 AI 漫剧体系其他技能的关系

- **导演意图层**：`ai-manhua-director-thinking`（L3·导演意图锚）定"为什么这么拍"，再用本体系写成 H3 格式——本体系不重写导演方法学。
- **一镜到底**：`ai-manhua-onetake-prompt`（L3a）是 Seedance 方言；若用户指定 H3 做一镜到底，用本体系"核心创意写一镜到底 + 画面过程不分 shot 切镜"（范式 A）或 `Static Shot`/单 shot（范式 B/C），机位纪律引用 onetake §Camera-First 单源。
- **通用分镜**：`deepwhite-shotlist-builder`（L3b）出 Seedance 13 项字段（正本 `ai-manhua-screenplay-comprehensive` §八）；需投 H3 时按 §七转译。
- **打戏全流程**：`design-fight-videos`（L3·打戏导演专层）负责"素材收据→资产锁定→战斗路线→分镜→A稿→平台B稿编译"（含 MiniMax H3 平台画像）；**范式 E 只管 MiniMax 单条武戏提示词直出**——走全流程用 design-fight-videos，要单条直出用范式 E，两者分权互补、互不引用内容。
- **提示词总库**：`ai-manhua-prompt-library`（L1）通用共用分支可纳入本体系 H3 风格 goodcase 作素材（整理优化层 L5 负责归档）。
- **提示词优化**：`prompt-alchemist` 可对本体系任意范式输出做进一步提纯（四元蒸馏框架）。

---

## 九、references 索引

- `00_索引.md` —— 本目录总索引与使用纪律
- `01_公式与四要素.md` —— 【手册原文 · 1.1+1.2】范式 A 素材用途/核心创意/画面过程 + 示例
- `02_三类模式与镜头拆解.md` —— 【手册原文 · 1.3+1.4】范式 A 多模态/图生/纯文生 + J/L-cut
- `03_风格goodcase_大字幕MV.md` —— 【手册原文 · 2.1】大字幕 trap MV 完整案例
- `04_风格goodcase_手绘特效.md` —— 【手册原文 · 2.2】手绘发光涂鸦案例
- `05_负向约束与对照表.md` —— 【手册原文归纳】H3 负向约束 + 插拔式 negative
- `06_API字段范式与全参考Ref2VA.md` —— 【体系融合】范式 B/C 中文综合（字段/标签/示例）
- `07_H3vsSeedance对照表.md` —— 【体系扩展】H3 ↔ Seedance 转译映射
- `08_official_base-en.txt` —— 【官方原文保真】基础模式（T2VA/I2VA/FL2VA/L2VA）英文指南
- `09_official_ref-en.txt` —— 【官方原文保真】全参考 Ref2VA 六段式英文指南
- `10_文戏对话单元范式.md` —— 【文戏模板原文 · 2026-09-07 入库】范式 D 唯一正本：填写规则/生成前引导/单人双人模板/画外音/轻喜剧/拥抱亲吻替换块/固定尾部/交付检查 + 污染隔离铁律
- `11_武戏动作导演范式.md` —— 【武戏模板原文 · 2026-09-07 入库】范式 E 唯一正本：用户输入表/信息优先级/参考图识别/武器能力判断/战斗载体路由/攻防适配/逐秒结构/物理反馈/全局禁止项/输出格式 + design-fight-videos 边界与污染隔离铁律
