$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$plan = Join-Path $projectRoot '01_产品方案/v1.1_MiniMax_H3_剧本拆分与分镜工作台方案.md'
$technicalPlan = Join-Path $projectRoot '02_技术方案/v1.0_剧本拆分工作台完整技术方案.md'
$index = Join-Path $projectRoot '00_索引/项目导航.md'

function Assert-True($condition, $message) {
    if (-not $condition) { throw $message }
}

Assert-True (Test-Path -LiteralPath $plan) '方案文件不存在'
Assert-True (Test-Path -LiteralPath $technicalPlan) '技术方案文件不存在'
Assert-True (Test-Path -LiteralPath $index) '导航文件不存在'
$body = Get-Content -LiteralPath $plan -Raw -Encoding UTF8
$technicalBody = Get-Content -LiteralPath $technicalPlan -Raw -Encoding UTF8
$nav = Get-Content -LiteralPath $index -Raw -Encoding UTF8

$required = @(
    '文戏、武戏、综合', '15 秒', '最多选用 6 张参考图',
    '同一张图', '描述正本', '阻断导出', '重复导出', '只读规则来源'
)
foreach ($term in $required) {
    Assert-True ($body.Contains($term)) "方案缺少契约：$term"
}

$fields = @(
    '人物参考图的描述', '场景参考图的描述', '景别', '构图', '焦距',
    '运镜', '光源', '氛围', '人物站位 + 朝向', '肢体动作（方位/动线）',
    '微表情', '台词 / 内心OS / 旁白', '音效', '衔接'
)
$example = [regex]::Match($body, 'SC07【推门停步｜4s】(?s:.*?)SC08【触及封口｜6s】').Value
Assert-True ($example.Length -gt 0) '14字段示例或镜头标题缺失'
$previousPosition = -1
for ($i = 0; $i -lt $fields.Count; $i++) {
    $number = [char](0x2460 + $i)
    $line = [regex]::Escape("$number $($fields[$i])：")
    $match = [regex]::Match($example, "(?m)^$line")
    Assert-True ($match.Success -and $match.Index -gt $previousPosition) "第$($i + 1)字段缺失或乱序：$($fields[$i])"
    $previousPosition = $match.Index
}
$found = [regex]::Matches($example, '(?m)^[①-⑭] ').Count
Assert-True ($found -eq 14) "示例字段数量应为14，实际为$found"
Assert-True ($body.Contains('SC09【门外脚步｜5s】')) '15秒示例的第三镜缺失'
Assert-True ((4 + 6 + 5) -eq 15) '示例镜头时长不等于15秒'

$relativeLink = '../01_产品方案/v1.1_MiniMax_H3_剧本拆分与分镜工作台方案.md'
Assert-True ($nav.Contains($relativeLink)) '导航未指向当前方案'
Assert-True (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $index) $relativeLink)) '导航目标不存在'
Assert-True ($nav.Contains('tests/方案文档.Tests.ps1')) '导航未登记测试'
Assert-True ($nav.Contains('99_过程归档/2026-09-28_阶段一闭环实施记录.md')) '导航未登记实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot '99_过程归档/2026-09-28_阶段一闭环实施记录.md')) '实施归档不存在'
Assert-True ($nav.Contains('99_过程归档/2026-09-28_Word与参考图描述实施记录.md')) '导航未登记 Word 与图片描述归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot '99_过程归档/2026-09-28_Word与参考图描述实施记录.md')) 'Word 与图片描述归档不存在'
Assert-True ([regex]::Matches($body, '[A-F0-9]{64}').Count -eq 4) '规则来源的4个SHA-256未完整登记'

$upgradePlan = Join-Path $projectRoot '01_产品方案/9.30升级方案.md'
Assert-True (Test-Path -LiteralPath $upgradePlan) '升级方案文件不存在'
$upgradeBody = Get-Content -LiteralPath $upgradePlan -Raw -Encoding UTF8

$upgradeRequired = @(
    '本地优先', 'AI 可选', '一键生成', '自动识别', 'IndexedDB', '测试连接',
    '骨架不动', '零篡改', '15 秒一段', '三级置信度', '未分配区', '内含多集',
    'TRANSITION_FORBIDDEN', 'SHOT_DURATION_MAX',
    'AUTO_MATCH_LOW_CONFIDENCE', 'EPISODE_SPLIT_UNVERIFIED'
)
foreach ($term in $upgradeRequired) {
    Assert-True ($upgradeBody.Contains($term)) "升级方案缺少契约：$term"
}

$upgradeFields = @(
    '人物参考图的描述', '场景参考图的描述', '景别', '构图', '焦距',
    '运镜', '光源', '氛围', '人物站位 + 朝向', '肢体动作',
    '微表情', '台词 / 内心OS', '音效', '衔接'
)
foreach ($field in $upgradeFields) {
    Assert-True ($upgradeBody.Contains($field)) "升级方案未登记骨架条目：$field"
}
Assert-True ($upgradeBody.Contains('14 个正文条目的定义、顺序、标签一个不改')) '升级方案未声明骨架不变契约'
Assert-True ($upgradeBody.Contains('闪黑') -and $upgradeBody.Contains('单纯拉')) '升级方案未登记转场禁词范围'
$upgradeRelativeLink = '../01_产品方案/9.30升级方案.md'
Assert-True ($nav.Contains($upgradeRelativeLink)) '导航未指向升级方案'
Assert-True (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $index) $upgradeRelativeLink)) '升级方案导航目标不存在'

$technicalRequired = @(
    'Electron', 'React + TypeScript', 'SQLite', '内置 Skill 模块',
    'minimax-h3', 'minimax-h3-video-prompt', 'Skill 可拆卸、可更新、可回滚', 'skeletonVersion',
    '14 字段正文骨架只属于 `minimax-h3` 模块', '按四类剧型接入导演与分镜 Skill',
    'short-drama', 'mid-drama', 'long-drama', 'film',
    'short-drama-factory', 'ai-manhua-mid-drama-rebuild',
    'ai-manhua-long-drama-screenplay', 'ai-manhua-film-screenplay',
    'ai-manhua-director-thinking', 'ai-manhua-emotion-clip',
    'ai-manhua-storyboard-qa', 'deepwhite-shotlist-builder-zh-user',
    'design-fight-videos', 'L3·导演意图锚', 'L4 交付闸门',
    'Seedance', 'Wan', 'nodeIntegration: false', 'contextIsolation: true'
)
foreach ($term in $technicalRequired) {
    Assert-True ($technicalBody.Contains($term)) "技术方案缺少架构契约：$term"
}
Assert-True (-not $technicalBody.Contains('└─ skeleton-14-fields')) '14字段骨架不应作为通用 Skill'
Assert-True (-not $technicalBody.Contains('director-language')) '导演模块应使用仓库 Skill ID 分类'
$technicalRelativeLink = '../02_技术方案/v1.0_剧本拆分工作台完整技术方案.md'
Assert-True ($nav.Contains($technicalRelativeLink)) '导航未指向技术方案'
Assert-True (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $index) $technicalRelativeLink)) '技术方案导航目标不存在'
$v11Required = @(
    'v1.1 升级增量', '一本多集', '批量导入', '三级置信度', '一键生成', '本地优先',
    'AI 可选', 'IndexedDB', '1→2', 'SHOT_DURATION_MAX', 'TRANSITION_FORBIDDEN',
    'AUTO_MATCH_LOW_CONFIDENCE', 'EPISODE_SPLIT_UNVERIFIED', '已入库未绑定', '未分配区',
    '测试连接', '14 条骨架不变', '第N话', '第N集', 'Episode 0N'
)
foreach ($term in $v11Required) {
    Assert-True ($body.Contains($term)) "产品方案 v1.1 缺少契约：$term"
}
$upgradeArchive = '99_过程归档/2026-09-30_9.30升级实施记录.md'
Assert-True ($nav.Contains($upgradeArchive)) '导航未登记 9.30 升级实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $upgradeArchive)) '9.30 升级实施归档不存在'

$uiArchive = '99_过程归档/2026-09-30_界面中文化实施记录.md'
Assert-True ($nav.Contains($uiArchive)) '导航未登记界面中文化实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $uiArchive)) '界面中文化实施归档不存在'
Assert-True ($nav.Contains('electron/menu.ts')) '导航未登记应用菜单正本'

$gateArchive = '99_过程归档/2026-09-30_导出闸门与全部分集生成实施记录.md'
Assert-True ($nav.Contains($gateArchive)) '导航未登记导出闸门实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $gateArchive)) '导出闸门实施归档不存在'
Assert-True ($nav.Contains('src/platforms/minimax-h3/gate.ts')) '导航未登记按集导出审计模块'

$gateRequired = @(
    '全书阻断清单', '全部分集生成', '导演决策已生成', '建议复核', 'issuePolicy',
    '按**集**判定', '导出按钮不得因任一条问题永久失效', '输入不完整', '原图描述缺失', '剧本结构 / 台词不一致'
)
foreach ($term in $gateRequired) {
    Assert-True ($body.Contains($term)) "产品方案缺少闸门契约：$term"
}
$upgradeGateRequired = @(
    'issuePolicy', '建议复核', '全部分集生成', '导演决策已生成', '二次修订', '全书阻断清单'
)
foreach ($term in $upgradeGateRequired) {
    Assert-True ($upgradeBody.Contains($term)) "升级方案缺少闸门契约：$term"
}
$gateBody = Get-Content -LiteralPath (Join-Path $projectRoot $gateArchive) -Raw -Encoding UTF8
foreach ($term in @('issuePolicy', 'applyGenerationBatch', 'focusTarget', '51 个测试全绿', '9/9 通过')) {
    Assert-True ($gateBody.Contains($term)) "导出闸门归档缺少证据：$term"
}

$importArchive = '99_过程归档/2026-10-01_导入载荷分流与乱码修复记录.md'
Assert-True ($nav.Contains($importArchive)) '导航未登记导入载荷分流实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $importArchive)) '导入载荷分流实施归档不存在'
Assert-True ($nav.Contains('electron/text.ts')) '导航未登记导入载荷分流正本'
$importBody = Get-Content -LiteralPath (Join-Path $projectRoot $importArchive) -Raw -Encoding UTF8
foreach ($term in @('sniffScriptPayload', 'isZipContainer', 'U+FFFD', '无 BOM 的 UTF-16', '81 项')) {
    Assert-True ($importBody.Contains($term)) "导入载荷分流归档缺少证据：$term"
}

$crewArchive = '99_过程归档/2026-10-01_站位姓名与剧情设计生成修复记录.md'
Assert-True ($nav.Contains($crewArchive)) '导航未登记站位姓名与剧情设计生成归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $crewArchive)) '站位姓名与剧情设计生成归档不存在'
$crewBody = Get-Content -LiteralPath (Join-Path $projectRoot $crewArchive) -Raw -Encoding UTF8
foreach ($term in @('isCastName', 'emotionDesigns', 'arcStages', 'episodeHeadingOf', '467 → 109', '565 → 0', '82/82')) {
    Assert-True ($crewBody.Contains($term)) "站位姓名与剧情设计生成归档缺少证据：$term"
}

$ambienceArchive = '99_过程归档/2026-10-01_音效空间底噪与孤儿模块清理记录.md'
Assert-True ($nav.Contains($ambienceArchive)) '导航未登记音效空间底噪与孤儿模块清理归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $ambienceArchive)) '音效空间底噪与孤儿模块清理归档不存在'
$ambienceBody = Get-Content -LiteralPath (Join-Path $projectRoot $ambienceArchive) -Raw -Encoding UTF8
foreach ($term in @('ambienceCues', 'genericAmbience', '90.7%', '85/85', 'electron/text.ts')) {
    Assert-True ($ambienceBody.Contains($term)) "音效空间底噪归档缺少证据：$term"
}

$speakerArchive = '99_过程归档/2026-10-01_正文误判台词与场景光源派生记录.md'
Assert-True ($nav.Contains($speakerArchive)) '导航未登记正文误判台词与场景光源派生实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $speakerArchive)) '正文误判台词与场景光源派生实施归档不存在'
$speakerBody = Get-Content -LiteralPath (Join-Path $projectRoot $speakerArchive) -Raw -Encoding UTF8
foreach ($term in @('speakerTrusted', 'isBriefLabel', 'sceneMarkerOf', 'fieldLabelTail', '91/91', '13/13')) {
    Assert-True ($speakerBody.Contains($term)) "正文误判台词与场景光源派生归档缺少证据：$term"
}
Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'shared'))) '空 shared 目录应已清理'
Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'src/core/text.js'))) 'src/core/text.js 孤儿副本应已清理'

$axisArchive = '99_过程归档/2026-10-01_说话人命名与场次轴线锚修复记录.md'
Assert-True ($nav.Contains($axisArchive)) '导航未登记说话人命名与场次轴线锚实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $axisArchive)) '说话人命名与场次轴线锚实施归档不存在'
$axisBody = Get-Content -LiteralPath (Join-Path $projectRoot $axisArchive) -Raw -Encoding UTF8
foreach ($term in @('sceneAnchorOf', 'stagingFor', 'shotSpeakers', 'roleSpeaker', 'narrationSubjects', '95 → 62', '110 → 0', '98/98')) {
    Assert-True ($axisBody.Contains($term)) "说话人命名与场次轴线锚归档缺少证据：$term"
}
Assert-True ($nav.Contains('场次轴线锚')) '导航未登记场次轴线锚实施行'
Assert-True ($nav.Contains('名册唯一发现通道')) '导航未登记名册唯一发现通道实施行'

$linkArchive = '99_过程归档/2026-10-01_衔接按证据选型修复记录.md'
Assert-True ($nav.Contains($linkArchive)) '导航未登记衔接按证据选型实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $linkArchive)) '衔接按证据选型实施归档不存在'
$linkBody = Get-Content -LiteralPath (Join-Path $projectRoot $linkArchive) -Raw -Encoding UTF8
foreach ($term in @('pickTransition', 'transitionRules', 'closingTransition', 'sceneChangeTransition', '1593', '35.3%', '101/101')) {
    Assert-True ($linkBody.Contains($term)) "衔接按证据选型归档缺少证据：$term"
}
Assert-True ($nav.Contains('衔接按证据选型')) '导航未登记衔接按证据选型实施行'

$auditArchive = '99_过程归档/2026-10-01_一致性审计通用化记录.md'
Assert-True ($nav.Contains($auditArchive)) '导航未登记一致性审计通用化实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $auditArchive)) '一致性审计通用化实施归档不存在'
$auditBody = Get-Content -LiteralPath (Join-Path $projectRoot $auditArchive) -Raw -Encoding UTF8
foreach ($term in @('auditEpisodeContent', 'rules.ts', 'AXIS_JUMP', 'TRANSITION_PREMISE', 'BLOCKING_UNKNOWN_SUBJECT', 'audit:script', '62 → 68', '108/108')) {
    Assert-True ($auditBody.Contains($term)) "一致性审计通用化归档缺少证据：$term"
}
Assert-True ($nav.Contains('通用一致性审计')) '导航未登记通用一致性审计模块'
Assert-True ($nav.Contains('src/platforms/minimax-h3/audit.ts')) '导航未登记审计模块路径'
Assert-True ($nav.Contains('src/platforms/minimax-h3/rules.ts')) '导航未登记闸门规则叶子模块'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'vitest.audit.config.ts')) '体检专用 vitest 配置不存在'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'scripts/audit-script.mjs')) '体检入口脚本不存在'
$pkg = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8
Assert-True ($pkg.Contains('audit:script')) 'package.json 未登记 audit:script 命令'

$scaleArchive = '99_过程归档/2026-10-01_景别档位随入画人数校正记录.md'
Assert-True ($nav.Contains($scaleArchive)) '导航未登记景别档位随入画人数校正实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $scaleArchive)) '景别档位随入画人数校正实施归档不存在'
$scaleBody = Get-Content -LiteralPath (Join-Path $projectRoot $scaleArchive) -Raw -Encoding UTF8
foreach ($term in @('gradeForShot', 'ShotGrade', 'pairGrades', 'emptyGrades', 'scaleSubjectConflict', '双人中近景', 'leadingShotMarker', '309', '114/114')) {
    Assert-True ($scaleBody.Contains($term)) "景别档位校正归档缺少证据：$term"
}
Assert-True ($nav.Contains('gradeForShot')) '导航未登记景别档位唯一来源 gradeForShot'
Assert-True ($nav.Contains('scaleSubjectConflict')) '导航未登记景别相容性同源判据'
Assert-True ($nav.Contains('③ 景别档位随入画人数校正')) '导航未登记景别档位校正实施行'
Assert-True ($nav.Contains('代词主语识别')) '导航未登记代词主语识别实施行'
Assert-True ($nav.Contains('双人中近景')) '导航未登记双人中近景档位'
$director = Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/director.ts') -Raw -Encoding UTF8
Assert-True ($director.Contains('export function gradeForShot')) '景别档位唯一来源 gradeForShot 不存在'
Assert-True ($director.Contains('export function scaleSubjectConflict')) '景别相容性同源判据 scaleSubjectConflict 不存在'
Assert-True ($director.Contains('leadingShotMarker')) '行首镜头标记剥离不存在'
Assert-True ((Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/audit.ts') -Raw -Encoding UTF8).Contains('scaleSubjectConflict')) '审计未接入景别相容性同源判据'

# 字段编号回归护栏：正本 = ⑦光源 ⑧氛围 ⑨站位 ⑩肢体动作 ⑪微表情。
# src/ 与 electron/ 下不得再出现旧写法；99_过程归档/ 与方案文档的历史文本保留当时写法、不追改。
$driftPattern = '⑦站位|⑦ 站位|⑧肢体动作|⑧ 肢体动作|⑨微表情|⑨ 微表情'
$drift = @(
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src') -Recurse -File |
        Where-Object { $_.Extension -in '.ts', '.tsx' } |
        Select-String -Pattern $driftPattern
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'electron') -Recurse -File |
        Where-Object { $_.Extension -in '.ts', '.cts' } |
        Select-String -Pattern $driftPattern
)
$driftList = ($drift | ForEach-Object { "$($_.Path):$($_.LineNumber)" }) -join ', '
Assert-True ($drift.Count -eq 0) "src/ 或 electron/ 下仍有字段编号旧写法残留：$driftList"
Assert-True ($nav.Contains('字段编号口径')) '导航未登记字段编号口径（扫尾结果）'

# 通用 AI 接入层：只填地址即接多家，密钥由主进程持有、界面不可见。
$aiArchive = '99_过程归档/2026-10-04_通用AI接入层记录.md'
Assert-True ($nav.Contains($aiArchive)) '导航未登记通用 AI 接入层实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $aiArchive)) '通用 AI 接入层实施归档不存在'
$aiBody = Get-Content -LiteralPath (Join-Path $projectRoot $aiArchive) -Raw -Encoding UTF8
foreach ($term in @('ai-providers', 'ai-client', 'Anthropic', 'reasoning_effort', 'redact', '142 项', '17/17')) {
    Assert-True ($aiBody.Contains($term)) "通用 AI 接入层归档缺少证据：$term"
}
Assert-True ($nav.Contains('electron/ai-providers.ts')) '导航未登记厂商注册表'
Assert-True ($nav.Contains('electron/ai-client.ts')) '导航未登记通用接入层唯一出口'
Assert-True ($nav.Contains('electron/credentials.ts')) '导航未登记本机凭据模块'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'electron/ai-providers.ts')) '厂商注册表文件不存在'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'electron/ai-client.ts')) '通用接入层文件不存在'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'electron/credentials.ts')) '本机凭据模块不存在'
$providers = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/ai-providers.ts') -Raw -Encoding UTF8
Assert-True ($providers.Contains('export function reasoningPayload')) '推理强度映射函数不存在'
Assert-True ($providers.Contains('export function providerFromURL')) '按地址识别厂商函数不存在（界面已无厂商下拉）'
Assert-True ($providers.Contains('requiresBaseURL')) '自填端点标记不存在'
$aiClient = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/ai-client.ts') -Raw -Encoding UTF8
Assert-True ($aiClient.Contains('export function redact')) '密钥脱敏函数不存在'
Assert-True ($aiClient.Contains('export async function listModels')) '模型列表函数不存在'
Assert-True ($aiClient.Contains('x-api-key')) 'Anthropic 鉴权头缺失'
# 保密护栏 1：主进程接入层不得自行读取环境变量取密钥，密钥只能由运行时入参传入。
Assert-True (-not $aiClient.Contains('import.meta.env')) '接入层不得读取环境变量中的密钥'
# 保密护栏 2：对外状态只回布尔量，绝不回传密钥本体。
$credentials = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/credentials.ts') -Raw -Encoding UTF8
Assert-True ($credentials.Contains('export function credentialsStatus')) '本机凭据状态查询不存在'
Assert-True ($credentials.Contains('configured: Boolean')) '对外状态未把密钥压缩为布尔量'
Assert-True ($credentials.Contains("values.WORKBENCH_API_KEY")) '本机密钥键名不是无 VITE_ 前缀的 WORKBENCH_API_KEY'
# 保密护栏 3：界面可手填密钥（只驻留内存、不落盘），但不得再出现厂商下拉。
# P0 拆壳（2026-10-05）：编排留在 `src/App.tsx`，视图分居 `src/panes/`。
# 契约断言的对象随之由「单个文件」改为「整个渲染层」—— 断言的意图是「这个实现不得被删掉」，
# 而不是「必须写在某个文件里」。**刻意不扩到 `src/core` / `electron`**：
# `core/vision.ts` 的注释含「保存到本机」，扩到全 src 会让下面的 -not 断言误红。
$appFiles = @((Join-Path $projectRoot 'src/App.tsx')) + @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src/panes') -Recurse -File | Where-Object { $_.Extension -in '.ts', '.tsx' } | ForEach-Object { $_.FullName })
$app = ($appFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw -Encoding UTF8 }) -join "`n"
Assert-True ($app.Contains('aria-label="密钥"')) '界面缺少密钥输入框'
Assert-True ($app.Contains('type="password"')) '密钥输入框未按密码类型遮蔽'
Assert-True (-not $app.Contains('localStorage.setItem(apiKey')) '密钥不得写入本地存储'
Assert-True (-not $app.Contains('aria-label="厂商"')) '界面不应再出现厂商下拉'
# 接口设置的技术项按老大定稿写法「英文在前、中文括注」，须防被当作「英文残留」清理掉。
Assert-True ($app.Contains('url（接口地址）')) '接口地址未按要求中英对照'
Assert-True ($app.Contains('key（密钥）')) '密钥未按要求中英对照'
# 老大定稿：url 与 key 就绪前不渲染「模型」项。
Assert-True ($app.Contains('模型项在 url 与 key 就绪前不渲染')) '模型项未按「url 与 key 就绪前不显示」实现'
Assert-True ($app.Contains("apiKey.trim() !== '' || localCredentials?.configured === true")) '模型项的就绪判据不是「手填密钥或本机已配置」'
# 密钥常驻（老大 2026-10-04 二次裁定）：**填入即自动写入本机**，界面不再设「保存到本机」按钮（越干净越好）；
# 写入仍只由主进程完成，渲染层仍然不落盘、回执仍只有布尔量。
Assert-True (-not $app.Contains('保存到本机')) '界面不应再有「保存到本机」按钮（密钥填入即自动常驻）'
Assert-True ($app.Contains('requestSaveCredentials')) '密钥自动常驻未走主进程写入通道'
Assert-True ($app.Contains('keyTouched')) '密钥自动写入缺少「用户是否动过输入框」闸门（会在打开面板时抹掉本机密钥）'
Assert-True ($app.Contains('本机已保存')) '本机已存密钥时未以圆点占位符提示「它就是那把」'
Assert-True (-not $app.Contains("localStorage.setItem(apiKey") -and -not $app.Contains("localStorage.setItem('script-storyboard-workbench-key'")) '密钥不得由渲染层直接落盘'
Assert-True ($credentials.Contains('export function saveLocalCredentials')) '本机凭据模块缺少写入能力'
Assert-True ($credentials.Contains('WORKBENCH_API_ENDPOINT')) '本机凭据未管理接口地址键'
$preload = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/preload.cts') -Raw -Encoding UTF8
Assert-True ($preload.Contains('credentials:save')) 'preload 未暴露密钥保存通道'
$main = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/main.ts') -Raw -Encoding UTF8
Assert-True ($main.Contains("ipcMain.handle('credentials:save'")) '主进程未注册密钥保存通道'
Assert-True ($main.Contains('saveLocalCredentials')) '主进程未把密钥写入本机私有配置'
# 启动卡顿（老大 2026-10-04「打开后还是会卡住，鼠标放在按键上大概三秒后才有反应」）：
# 参考图缩略图只显示 56×56，但把 `data:image/...` 直接挂到 `src` 会让浏览器按**原图分辨率**在提交帧里解码。
# 实测给样例塞 12 张 1024×1024 噪声 PNG：DOM 就绪 3658ms → 改为「进视口才解码 + object URL」后 604ms。
# 这条防回流：不得再退回直挂 dataUrl。
Assert-True ($app.Contains('IntersectionObserver')) '参考图未按「进入视口才解码」实现（会把 data URL 全量在首屏解码）'
Assert-True (-not $app.Contains('src={image.dataUrl}')) '参考图缩略图又把 dataUrl 直接挂到 src 了（首屏会按原图分辨率解码，回到卡顿）'
# `index.html` 的 CSP 是 `img-src 'self' data:`，**不含 blob:**；`connect-src` 也不含 data:。
# 因此 object URL 与 `fetch(dataUrl)` 都会被拦，再静默回退成 data URL ——「表面有收益、实际空转」，
# 属本项目明令反对的静默失败。这条防回流：不得再引入依赖 blob: 的取图路径。
# 注意：`src/App.tsx` 第 44 行导出下载本来就用 `URL.createObjectURL`（与图片无关），故不对此做全局否定断言，
# 改为对「进视口才挂 src」这一机制做正向断言 —— 一旦有人退回无条件挂载，这里会立刻红。
Assert-True ($app.Contains('src={near ? dataUrl : undefined}')) '参考图缩略图未按「进入视口才挂 src」实现（无条件挂载会退回首屏全量解码）'
$e2e = Get-Content -LiteralPath (Join-Path $projectRoot 'tests/e2e/workbench.spec.ts') -Raw -Encoding UTF8
Assert-True ($e2e.Contains('waitForMainThreadIdle')) '启动性能用例缺少「主线程真正空闲」判据（等元素出现 ≠ 可交互，会漏掉提交帧里的解码成本）'
Assert-True ($e2e.Contains('naturalWidth')) '参考图性能用例未验证图片真的解码出来（只验节点存在会漏掉「图没加载」）'

# AI 主路径：AI 就绪时一键生成 / 全部分集生成改为「逐段依次推理」，本地规则只作单段兜底。
Assert-True ($app.Contains('aiSegmentDrafts')) '界面未实现 AI 逐段推理通道'
Assert-True ($app.Contains('contextAfter')) 'AI 依次推理未实现段间上下文传递'
Assert-True ($app.Contains('previousBlocking: previous.blocking')) 'AI 请求未把上一段的站位传入上下文'
Assert-True ($app.Contains('AI 依次推理')) '界面缺少 AI 依次推理的进度 / 结果文案'
Assert-True ($app.Contains('已回退本地规则结果')) 'AI 单段失败未回退该段本地结果'
Assert-True ($app.Contains('本地规则导演已填充')) 'AI 未就绪时的本地保底路径被移除'
$storeBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/store.ts') -Raw -Encoding UTF8
Assert-True ($storeBody.Contains('draft.source ?? options.source')) '回填来源未按草稿自带者逐镜标记'
$aiFirstArchive = '99_过程归档/2026-10-04_AI主路径依次推理实施记录.md'
Assert-True ($nav.Contains($aiFirstArchive)) '导航未登记 AI 主路径依次推理实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $aiFirstArchive)) 'AI 主路径依次推理实施归档不存在'
$aiFirstBody = Get-Content -LiteralPath (Join-Path $projectRoot $aiFirstArchive) -Raw -Encoding UTF8
foreach ($term in @('aiSegmentDrafts', 'previousLight', '单段失败', '148 项')) {
    Assert-True ($aiFirstBody.Contains($term)) "AI 主路径实施归档缺少证据：$term"
}

# 生成按钮随 AI 就绪换形态（老大 2026-10-04 定稿）：一键生成 → 「AI 依次推理」；
# 「全部分集生成」与「一键生成」语义重复，已改为「选择集生成」并可自选要生成哪些集。
Assert-True ($app.Contains('data-ai')) '生成按钮未随 AI 就绪暴露可断言的状态'
Assert-True ($app.Contains('AI 依次推理')) 'AI 就绪时一键生成未换成「AI 依次推理」'
Assert-True ($app.Contains('选择集生成')) '界面缺少「选择集生成」入口'
Assert-True ($app.Contains('pickerOpen')) '未实现选集浮层状态'
Assert-True ($app.Contains('generateEpisodes')) '选集生成未按传入的集列表执行'
Assert-True ($app.Contains('episodeIds.includes(item.id)')) '选集生成未按勾选的集过滤目标'
Assert-True (-not $app.Contains('generateAll')) '旧的整本生成入口应已由选集生成取代'
# 折叠态不渲染 DOM 也不计算：分集核对清单折叠时不得整本解析（大剧本一次可达数百毫秒）。
Assert-True ($app.Contains('splitOpen && sourceText ? splitEpisodes(sourceText) : null')) '分集核对清单在折叠态仍会整本解析'

$credArchive = '99_过程归档/2026-10-04_密钥常驻与选集生成实施记录.md'
Assert-True ($nav.Contains($credArchive)) '导航未登记密钥常驻与选集生成实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $credArchive)) '密钥常驻与选集生成实施归档不存在'
$credBody = Get-Content -LiteralPath (Join-Path $projectRoot $credArchive) -Raw -Encoding UTF8
foreach ($term in @('keyTouched', 'credentialsDirs', '选择集生成', 'generateEpisodes', '55.1MB', '3650ms')) {
    Assert-True ($credBody.Contains($term)) "密钥常驻与选集生成归档缺少证据：$term"
}

# 时长不变量：段 = 15 秒、**段内各镜之和 = 15 秒**、单镜 ∈ [1, 12] 秒。
# 正本在 core/timing.ts，planner 与 director 共用；rules.ts 只转发，不得就地重复定义。
$timingPath = 'src/core/timing.ts'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $timingPath)) '段内时长分配正本 core/timing.ts 不存在'
$timing = Get-Content -LiteralPath (Join-Path $projectRoot $timingPath) -Raw -Encoding UTF8
foreach ($term in @('export function allocateShotDurations', 'export const segmentDuration = 15', 'export const shotDurationMax = 12', 'export const shotDurationMin = 1')) {
    Assert-True ($timing.Contains($term)) "时长分配正本缺少：$term"
}
$rulesBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/rules.ts') -Raw -Encoding UTF8
Assert-True ($rulesBody.Contains("from '../../core/timing'")) '时长常量未从 core/timing 转发（禁止就地重复定义）'
# P1 判据 JSON 化（2026-10-06）：闸门分级表**本体**已收拢到 `skill-default.ts`，`rules.ts` 只做再导出。
# 断言的意图是「闸门必须登记」，故指向判据正本；另加一条「rules.ts 不得就地重定义」防回流。
$skillDefaultPath = 'src/platforms/minimax-h3/skill-default.ts'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $skillDefaultPath)) '内置默认判据包 skill-default.ts 不存在'
$skillDefaultBody = Get-Content -LiteralPath (Join-Path $projectRoot $skillDefaultPath) -Raw -Encoding UTF8
Assert-True ($skillDefaultBody.Contains("SHOT_DURATION_MAX: { severity: 'error', category: 'input' }")) 'SHOT_DURATION_MAX 未在闸门分级表登记'
Assert-True ($skillDefaultBody.Contains('transitionForbiddenWords')) '内置默认判据包缺少转场禁词表'
Assert-True ($skillDefaultBody.Contains('transitionTemplates')) '内置默认判据包缺少 ⑭ 成稿文案池'
Assert-True ($skillDefaultBody.Contains('skeletonFields')) '内置默认判据包缺少 14 格骨架正本'
Assert-True ($rulesBody.Contains('export { ignorableIssueCategories, issueCategoryNames, issuePolicy, transitionForbiddenWords };')) 'rules.ts 未从内置默认包再导出（判据应单源）'
Assert-True (-not ($rulesBody.Contains("SHOT_DURATION_MAX: { severity"))) 'rules.ts 又就地定义了闸门分级表（判据应单源，不得双写）'
# 判据已由「每条分镜时长必须为15秒」改为「段内各镜之和 = 15 秒 + 单镜上限」。
$validatorBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/validator.ts') -Raw -Encoding UTF8
Assert-True ($validatorBody.Contains('段内各镜时长之和须为')) '校验层未按「各镜之和 = 段长」判定'
Assert-True ($validatorBody.Contains("add('SHOT_DURATION_MAX'")) '校验层未真正落地 SHOT_DURATION_MAX 闸门'
Assert-True (-not $validatorBody.Contains('每条分镜时长必须为')) '旧的「每镜固定15秒」判据仍在'
Assert-True (-not $app.Contains('固定15秒')) '界面仍在宣称「固定15秒」'
Assert-True ($app.Contains('allocateShotDurations')) '界面未使用统一的时长分配器'

# 分集：首个切点之前的原文不丢弃（前置集）——老大反馈「识别不到第一集」的根因修复。
$episodesBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/episodes.ts') -Raw -Encoding UTF8
Assert-True ($episodesBody.Contains('function preludeOf')) '分集未实现前置集：首切点之前的原文仍会被丢弃'
Assert-True ($episodesBody.Contains('isEpisodeIndexHeading')) '前置集未剔除附录集号索引行'
Assert-True ($episodesBody.Contains('mergePreludeIntoFirst')) '集号冲突时未并入第 1 集'
Assert-True ($episodesBody.Contains('parseScript(prelude.text).beats.length')) '纯元数据前置未按「无节拍不成集」过滤'
$parserBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/parser.ts') -Raw -Encoding UTF8
Assert-True ($parserBody.Contains('export function isEpisodeIndexHeading')) '集号清单行判据未在解析层单源导出'
# 分集标记放行 Markdown 井号前缀（`### 第七集`）——老大《猫大夫的快乐处方》实测：
# 集标写成 Markdown 标题时行首是 `#`，旧口径只允许 `\s*` → 一个集标都识别不到 →
# 整本塌成「第01集」一集、491 段、24098 项阻断。
Assert-True ($parserBody.Contains('(?:#{1,6}\s+)?(?:第')) '分集标记未放行 Markdown 井号前缀（`### 第七集` 会识别不到）'
# 井号集标与 `isSceneHeading` 的井号分支同形，故集标判定必须先于场次判定，否则「第七集」冒充场次。
$markerAt = $parserBody.IndexOf('if (isEpisodeMarker(trimmed)) continue;')
$sceneAt = $parserBody.IndexOf('if (isSceneHeading(trimmed)) {')
Assert-True ($markerAt -ge 0 -and $sceneAt -ge 0 -and $markerAt -lt $sceneAt) '集标判定未先于场次判定（井号集标会冒充场次混入场次表）'
$mdMarkerArchive = '99_过程归档/2026-10-05_Markdown集标识别修复记录.md'
Assert-True ($nav.Contains($mdMarkerArchive)) '导航未登记 Markdown 集标识别修复归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $mdMarkerArchive)) 'Markdown 集标识别修复归档不存在'
$mdMarkerBody = Get-Content -LiteralPath (Join-Path $projectRoot $mdMarkerArchive) -Raw -Encoding UTF8
foreach ($term in @('episodeCapture', '#{1,6}', 'isSceneHeading', '491 段', '24098')) {
    Assert-True ($mdMarkerBody.Contains($term)) "Markdown 集标归档缺少证据：$term"
}
# 解析口径对账（2026-10-05）：分集是**持久化**的 —— 升级识别口径后已存存档不会自己重算，
# 用户打开还是旧分集且毫无提示。根治 = 版本指纹 + 打开存档时对账（无用户内容自动重建 / 有则只提示）。
$plannerBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/planner.ts') -Raw -Encoding UTF8
$storeBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/store.ts') -Raw -Encoding UTF8
$modelBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/model.ts') -Raw -Encoding UTF8
Assert-True ($parserBody.Contains('export const parserVersion')) '解析契约版本未在解析层单源导出'
Assert-True ($modelBody.Contains('parserVersion')) '存档结构未登记解析契约版本（旧存档无法对账）'
Assert-True ($plannerBody.Contains('export function reconcileSplit')) '缺少「打开存档时按解析口径对账」'
Assert-True ($plannerBody.Contains('export function rebuildEpisodes')) '缺少分集重建单一来源（replan 与自动对账必须共用，否则两套逻辑会各自演化）'
Assert-True ($plannerBody.Contains('export function hasUserContent')) '缺少「可否自动重建」的用户内容判据（会误删用户编辑）'
# 资产库全局化（2026-10-05）：资产由 `episode.images` 提升为项目级 `project.assets`。
# 原护栏的本意是「重建分集不得静默丢掉用户导入的资产」——本意不变，实现已换成
# 「资产在项目级、重建不碰」；因此判据随之改为「资产库非空必须算用户内容」。
Assert-True ($plannerBody.Contains('assets.length')) '重建判据未把资产库算作用户内容（导入过资产的存档会被自动重建误伤）'
Assert-True ($modelBody.Contains('assets: z.array(imageSchema)')) '缺少项目级资产库（资产仍会按集存放、换集即丢失）'
Assert-True ($modelBody.Contains('imageMatches')) '缺少逐集匹配记账（同图跨集的置信度会互相覆盖）'
# 搬迁必须**先于** schema 解析：zod 对未知键是剥离而非报错，顺序错了就是「解析成功但整本参考图被静默抹掉」。
# 2026-10-06 起这条链上多了一环（`retirePropAssets`，理由见下「道具图类退役」段），
# 故断言锚在「hoistEpisodeImages 是归一链的第一步」这个形状上，而不是某一行赋值。
$migrateBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/migrate.ts') -Raw -Encoding UTF8
Assert-True ($migrateBody.Contains('hoistEpisodeImages')) '缺少旧存档资产搬迁（按集存放的参考图会静默消失）'
Assert-True ($migrateBody.Contains('retirePropAssets(hoistEpisodeImages(raw))')) '搬迁未先于 schema 解析执行（未知键被剥离即丢图）'
$assetLibraryArchive = '99_过程归档/2026-10-05_资产库全局化实施记录.md'
Assert-True ($nav.Contains($assetLibraryArchive)) '导航未登记资产库全局化实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $assetLibraryArchive)) '资产库全局化实施归档不存在'
$assetLibraryBody = Get-Content -LiteralPath (Join-Path $projectRoot $assetLibraryArchive) -Raw -Encoding UTF8
foreach ($term in @('project.assets', 'episode.imageMatches', 'hoistEpisodeImages', 'pixelStatsCache')) {
    Assert-True ($assetLibraryBody.Contains($term)) "资产库全局化归档缺少证据：$term"
}
Assert-True ($storeBody.Contains('reconcileSplit')) '启动恢复未接解析口径对账（旧存档分集仍不会重算）'
Assert-True ($storeBody.Contains('splitStatus')) '对账结果未交给界面（会变成静默行为）'
Assert-True (-not $storeBody.Contains('planProject(text, old.defaultMode)')) 'replan 仍另写了一套重建逻辑（未复用 rebuildEpisodes）'
Assert-True ($app.Contains('splitStatus === ''stale''')) '旧口径有用户内容时界面未提示（坏分集被静默沿用）'
Assert-True ($app.Contains('splitStatus === ''rebuilt''')) '旧口径自动重建后界面未告知（静默改了用户数据）'
$parserReconcileArchive = '99_过程归档/2026-10-05_解析口径对账实施记录.md'
Assert-True ($nav.Contains($parserReconcileArchive)) '导航未登记解析口径对账实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $parserReconcileArchive)) '解析口径对账实施归档不存在'
$parserReconcileBody = Get-Content -LiteralPath (Join-Path $projectRoot $parserReconcileArchive) -Raw -Encoding UTF8
foreach ($term in @('parserVersion', 'reconcileSplit', 'hasUserContent', 'rebuildEpisodes')) {
    Assert-True ($parserReconcileBody.Contains($term)) "解析口径对账归档缺少证据：$term"
}
# 判据通用化（2026-10-05 · 老大「不是针对某一剧本做的优化，而是通用」）：
# 识别判据必须按**规律**判（构词 / 值形态 / 位置 / 结构），不得只按「见过的样本词」判 ——
# 样本词表永远追不上新剧本。实测一份虚构剧本证明旧口径会把 `订单`/`库存` 写进名册、
# 让主要人物 `林可` 整条消失、把三个未枚举标签整块泄漏成节拍。
Assert-True ($parserBody.Contains('const nonPersonNounTail')) '缺「非人名构词尾」判据（账目·器物名词会污染名册）'
Assert-True ($parserBody.Contains('const countTail')) '缺「数量尾」判据（`路人若干` 会被当成一个人）'
Assert-True ($parserBody.Contains('export function looksNumericValue')) '缺「值像账目数字」判据（`订单：2400 单待分配。` 会被当台词）'
Assert-True ($parserBody.Contains('const pending')) '缺待定台词行（数字开头的真台词会被永久吞掉）'
Assert-True ($parserBody.Contains('第二遍：回填')) '缺第二遍回填（名册攒齐后无法救回被暂判叙述的真台词）'
Assert-True ($parserBody.Contains('function isBareHeadingLine')) '缺「裸标题行」判据（前言区未枚举标签仍会泄漏为节拍）'
Assert-True ($parserBody.Contains('function looksMetadataShaped')) '缺「元数据形态」结构判据'
Assert-True ($parserBody.Contains('function documentBlockEnd')) '缺前言区文档层块判据'
Assert-True ($parserBody.Contains('let preface = lines.some(isEpisodeMarker)')) '前言区判据未以「整篇有集标」为启用前提（无集标稿会被乱猜）'
Assert-True ($parserBody.Contains('function castBlockEnd')) '缺人物表块结构判据（标题未枚举的人物表会丢整份名册）'
Assert-True ($parserBody.Contains('function rosterNamesOf')) '缺顿号名单行判据（`人物：灰灰、路人若干` 会把「人物」写进名册）'
Assert-True ($parserBody.Contains('const sceneTimeMark')) '场次标题未按时空标记判（`7-1 城市广场 日 外` 认不出来）'
Assert-True ($parserBody.Contains('const scenePlaceMark')) '场次标题缺「独立成词的内/外」判据'
Assert-True ($parserBody.Contains('const sceneNumberPrefix')) '场次标题缺集-场编号前缀判据（`7-1` / `1.` / `1、`）'
# ★ 反向护栏：`briefHeadings` 是老大**定稿稿前言统计表与附录「补写说明」格式的契约**
#（2026-10-01 修的 P0 泄漏节拍 → 0），不得因为「尾部标签看着像一次性残留」就被删 ——
# 通用化靠**增判据**，不靠删契约。
foreach ($term in @('六道护栏', '三条验收断言', '路A补写说明', '总账')) {
    Assert-True ($parserBody.Contains($term)) "定稿稿格式契约标签被删：$term"
}
Assert-True ($parserBody.Contains("parserVersion = '2026-10-05.2'")) '动了解析口径但未 bump 版本指纹（存量存档不会触发对账）'
$generalityArchive = '99_过程归档/2026-10-05_判据通用化实施记录.md'
Assert-True ($nav.Contains($generalityArchive)) '导航未登记判据通用化实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $generalityArchive)) '判据通用化实施归档不存在'
$generalityBody = Get-Content -LiteralPath (Join-Path $projectRoot $generalityArchive) -Raw -Encoding UTF8
foreach ($term in @('nonPersonNounTail', 'looksNumericValue', 'castBlockEnd', 'sceneTimeMark', 'parser-general-probe')) {
    Assert-True ($generalityBody.Contains($term)) "判据通用化归档缺少证据：$term"
}
$preludeArchive = '99_过程归档/2026-10-04_分集前置集保留实施记录.md'
Assert-True ($nav.Contains($preludeArchive)) '导航未登记分集前置集实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $preludeArchive)) '分集前置集实施归档不存在'
$preludeBody = Get-Content -LiteralPath (Join-Path $projectRoot $preludeArchive) -Raw -Encoding UTF8
foreach ($term in @('preludeOf', 'isEpisodeIndexHeading', '整段丢弃', '前置集')) {
    Assert-True ($preludeBody.Contains($term)) "分集前置集归档缺少证据：$term"
}

# 生成分片与暂停：长循环必须让帧，且可暂停 / 继续 / 终止。
Assert-True ($app.Contains('function yieldToMain')) '生成作业未实现分片让帧'
Assert-True ($app.Contains('MessageChannel')) '分片让帧未使用宏任务边界（setTimeout 有 4ms 下限）'
Assert-True ($app.Contains('const checkpoint = async')) '生成作业未接入分片检查点'
Assert-True ($app.Contains('jobStopped')) '终止未用哨兵退出当前分片'
Assert-True ($app.Contains('已暂停')) '界面缺少暂停反馈'
Assert-True ($app.Contains('已终止')) '界面缺少终止反馈'
Assert-True ($app.Contains('const batchSize = 3')) '整本生成未分批写入（终止会丢掉已完成的工作）'
Assert-True ($app.Contains('选集生成完成')) '选集生成的完成回执被移除'
$shardArchive = '99_过程归档/2026-10-04_生成分片与暂停实施记录.md'
Assert-True ($nav.Contains($shardArchive)) '导航未登记生成分片与暂停实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $shardArchive)) '生成分片与暂停实施归档不存在'
$shardBody = Get-Content -LiteralPath (Join-Path $projectRoot $shardArchive) -Raw -Encoding UTF8
foreach ($term in @('yieldToMain', 'checkpoint', '12 798 ms', '517 ms', 'MessageChannel')) {
    Assert-True ($shardBody.Contains($term)) "生成分片归档缺少证据：$term"
}
# 折叠态不渲染 DOM，也不做整本解析。
$sourcePane = Get-Content -LiteralPath (Join-Path $projectRoot 'src/panes/SourcePane.tsx') -Raw -Encoding UTF8
Assert-True ($sourcePane.Contains('showRecognized && sourceText ? parseScriptForPreview')) '原剧本面板折叠态仍会解析整本识别结果'
Assert-True ($sourcePane.Contains('展开后统计')) '折叠态未说明条数需展开后统计'

# e2e 前置：Playwright 每次运行都清空 outputDir，而本项目 teardown 会挂死留下数百个残留文件 ——
# 下一次运行的批量删除撞上宿主护栏（SAFE_DELETE_BULK_CONFIRM_REQUIRED）会让 e2e 直接跑不起来。
# 解法是「移走」而非删除，形状必须留在 test:e2e 脚本里。
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8
Assert-True ($packageJson.Contains('prepare-e2e.mjs')) 'e2e 未接入残留产物移走前置（teardown 挂死后的残留会撞宿主批量删除护栏）'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'scripts/prepare-e2e.mjs')) 'e2e 前置脚本 scripts/prepare-e2e.mjs 不存在'
$prepareE2eBody = Get-Content -LiteralPath (Join-Path $projectRoot 'scripts/prepare-e2e.mjs') -Raw -Encoding UTF8
Assert-True ($prepareE2eBody.Contains('renameSync')) 'e2e 前置脚本未用「移走」（renameSync）实现 —— 删除仍会触发宿主护栏'

# 资产面板交互（2026-10-05 老大反馈第 2/3/4 条）：分区呈现 · 描述人工触发 · 单张删除。
# 三条都要**防回流**：分区靠 assetKinds 单源；导入只入库靠 pickImages 里不再出现描述生成；
# 删除入口靠 store.removeImage（资产是项目级单源，删一张必须全本解除绑定）。
# **2026-10-06 追加裁定**（老大原话：「把左边的输入图片改为下拉选择人物，场景；道具选区不要了」，
# 追问后落定「连数据层一起退役」）：图类只剩两类，呈现形式由「三框并列」改为「下拉 + 已选标签」。
# **2026-10-19 再裁定（合并折叠，覆盖上一条的「两类各一组」）**：老大原话「点击出现人物和场景选项，
# 选择哪个显示哪一部分的资产」—— 两类收进**同一块**面板，由类别下拉切换、一次只渲染一类；
# 四键仍按类作用（破坏范围不变），选图出口仍唯一（`pickForSegment`）。
Assert-True ($app.Contains("export const assetKinds = ['character', 'scene'] as const;")) '资产未按人物/场景分区（两类顺序与名称必须单源；回落到三类即回流）'
Assert-True (-not ($app.Contains("'prop'"))) '「道具」图类回流了（老大 2026-10-06 裁定连数据层一起退役）'
Assert-True ($app.Contains('className="asset-picker"')) '资产区未改为「一块面板 + 类别下拉」呈现'
Assert-True ($app.Contains('aria-label={`选择${kindName}参考图`}')) '资产区缺少按类选择参考图的下拉（下拉是老大定的选图唯一出口）'
Assert-True ($app.Contains('aria-label={`本段已选${kindName}`}')) '资产区缺少「已选标签」区（下拉 + 已选标签是老大选定的形态）'
Assert-True (-not ($app.Contains('asset-group'))) '资产区退回了三框并列（同日已被「下拉 + 已选标签」推翻）'
Assert-True (-not ($app.Contains('asset-kind-menu'))) '资产区退回了「单入口 + 弹出小框」（三分之二资产被藏进菜单）'
Assert-True ($app.Contains('id="asset-kind"')) '缺少「人物 / 场景」类别下拉（合并折叠的唯一切换入口）'
Assert-True ($app.Contains('{assetKinds.map((item) => <option')) '类别下拉未从 assetKinds 单源派生（手写两份选项即双写）'
Assert-True (-not ($app.Contains('{assetKinds.map((kind) => {'))) '资产区又按类逐张渲染面板（合并折叠要求一次只渲染一类）'
Assert-True ($app.Contains('const kindOptionLabel')) '类别下拉缺少选项文案派生（缺口必须写在选中项上，否则折叠后看不见）'
Assert-True ($app.Contains('const supplyStatsOf')) '缺口统计未收口成单源（下拉与提示各算一次必然对不上）'
Assert-True ($app.Contains('清空本类全部资产')) '缺少「清空本类全部资产」入口'
Assert-True ($app.Contains('一键补充 AI 描述')) '缺少「一键补充 AI 描述」入口'
Assert-True ($app.Contains('prepared.push(await prepareImage(file, kind))')) '导入又自动生成了描述/分析（描述必须由人工点击补齐）'
Assert-True (-not ($app.Contains("description: buildLocalDescription"))) '导入路径又写回了自动描述（人工触发被绕过）'
Assert-True ($app.Contains('function removeAsset')) '缺少单张资产删除入口'
$storeBody2 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/store.ts') -Raw -Encoding UTF8
Assert-True ($storeBody2.Contains('removeImage(id) {')) '缺少删除资产的写入实现（会留下指向已删资产的悬挂绑定）'
$panelArchive = '99_过程归档/2026-10-05_资产面板分区与描述补齐记录.md'
Assert-True ($nav.Contains($panelArchive)) '导航未登记资产面板交互实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $panelArchive)) '资产面板交互实施归档不存在'
$panelBody = Get-Content -LiteralPath (Join-Path $projectRoot $panelArchive) -Raw -Encoding UTF8
foreach ($term in @('assetKinds', '补齐 AI 描述', '导入只入库', 'removeAsset')) {
    Assert-True ($panelBody.Contains($term)) "资产面板交互归档缺少证据：$term"
}

# P4 第二小步（UI 双界面 · 2026-10-06 定稿）：工作区收成**两栏**，左栏「输入与设定」四段可折叠，顶栏只留一处引擎状态。
# 定稿决策句（老大界面稿图 1）：「去掉 AI 专属的人物设定与弧光、去掉与模式开关重复的状态标识，
# 保留输入、资产、P 审阅台与本集校验」。落到判据上是下列正向 + 负向各数条。
# **2026-10-06 追加裁定**：图 1 里那项「本集校验」（右栏末项「H3 成品与质检」）随后被老大原话推翻 ——
# 「这块不要了」—— 面板整体移除，右栏只剩 P 审阅台；下列数条中涉及该面板者已翻为**负向锁死**。
$stylesBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/styles.css') -Raw -Encoding UTF8
# ① 两栏壳（原先的四栏已合并）。
Assert-True ($app.Contains('className="left-rail"')) '左栏「输入与设定」未落地'
Assert-True ($app.Contains('className="right-col"')) '右栏「生成与审阅」未落地'
Assert-True ($stylesBody.Contains('.workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(288px, 320px) minmax(0, 1fr); }')) '工作区未收成两栏栅格'
Assert-True (-not ($stylesBody.Contains('minmax(200px, 24%)'))) '工作区退回了四栏栅格（P4 定稿是两栏）'
Assert-True (-not ($stylesBody.Contains('.split-list'))) '左栏折叠段退回了 <details> 式的 .split-list 样式'
# ② 左栏四段可折叠：受控开关 + 折叠即卸载 + 可精确定位。
$sectionPane = Get-Content -LiteralPath (Join-Path $projectRoot 'src/panes/Section.tsx') -Raw -Encoding UTF8
Assert-True ($sectionPane.Contains('aria-expanded={open}')) '折叠段未暴露展开态（e2e 无法判定收起/展开）'
Assert-True ($sectionPane.Contains('data-section={name}')) '折叠段未暴露段名（左栏含「资产」二字的按钮不止一个，须能精确定位）'
Assert-True ($sectionPane.Contains('{open && <div className="rail-section-body">')) '折叠段未折叠即卸载（收起态仍渲染内容会拖慢每次重渲染）'
foreach ($name in @('剧本原稿', '分集清单', '资产')) {
    Assert-True ($app.Contains('<Section name="' + $name + '"')) "左栏缺少可折叠段：$name"
}
# 展开态必须留在编排层：分集清单的整本解析以它为依据，下沉进组件会让整本解析重回启动路径。
Assert-True ($app.Contains('splitOpen && sourceText ? splitEpisodes(sourceText) : null')) '分集清单的整本解析不再以展开态为依据'
# ③ 生成区固定在左栏底部（与顶栏一键生成同一个 handler）。
Assert-True ($app.Contains('className="gen-zone"')) '生成区未固定在左栏底部'
# ④ 顶栏只留**一处**引擎状态，且它不是一个纯显示 —— 点「本地」真关 AI 增强。
Assert-True ($app.Contains('className="engine-switch"')) '顶栏缺少本地/AI 分段控件'
Assert-True ($app.Contains('aria-label="生成引擎"')) '分段控件缺少无障碍名（e2e 与读屏都靠它定位）'
Assert-True ($app.Contains('saveSettings({ ai: false })')) '点「本地」没有真的关掉 AI 增强（分段控件退化成了纯显示）'
# ⑤「人物设定与弧光」**仅 AI 模式渲染**（定稿决策句前半句）。
Assert-True ($app.Contains('{aiReady && <Section name="人物设定与弧光"')) '「人物设定与弧光」未按定稿收成 AI 专属'
Assert-True ($app.Contains('className="cast-pane"')) '「人物设定与弧光」段内容（CastPane）未落地'
$castPane = Get-Content -LiteralPath (Join-Path $projectRoot 'src/panes/CastPane.tsx') -Raw -Encoding UTF8
Assert-True ($castPane.Contains('project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim()')) '「确认设定」判据与数据侧不一致（锚点为空时仍可确认）'
# **入口分侧 ≠ 数据分侧**：本地模式只是不提供录入入口，`project.visual` 两侧都在消费 ——
# 不得借界面重排把 ① ② 的文字兜底从取值口删掉（那会让**已有存档**的导出产物一起变空）。
$skeletonBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/skeleton.ts') -Raw -Encoding UTF8
Assert-True ($skeletonBody.Contains('文字设定：')) '① ② 的文字兜底被删（老存档导出产物里的 ① ② 会一起变空）'
$p4UiArchive = '99_过程归档/2026-10-06_P4UI双界面实施记录.md'
Assert-True ($nav.Contains($p4UiArchive)) '导航未登记 P4 UI 双界面实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $p4UiArchive)) 'P4 UI 双界面实施归档不存在'
$p4UiBody = Get-Content -LiteralPath (Join-Path $projectRoot $p4UiArchive) -Raw -Encoding UTF8
foreach ($term in @('rail-section-head', 'engine-switch', 'openSection', '两栏', '入口分侧')) {
    Assert-True ($p4UiBody.Contains($term)) "P4 UI 双界面归档缺少证据：$term"
}

# P4 **第二小步 b**（2026-10-06）：右栏 P 索引条 + 审阅台**整 P 铺开** + 「重新生成本 P」。
# （该步同时落地的「本集校验卡」已于同日按老大裁定**整体移除**，见下方 ③ 的负向锁死。）
# 前提是**既成事实而非新增**：P ≡ 段 —— `planner.ts:49` 造段即 `P01`…、`duration` 恒为 `segmentDuration`（15 秒），
# 故本步零数据侧改动，只改界面；判据、取值口、`src/platforms/**` 与 `electron/**` 一律不动。
$directorPane = Get-Content -LiteralPath (Join-Path $projectRoot 'src/panes/DirectorPane.tsx') -Raw -Encoding UTF8
$compilerBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/compiler.ts') -Raw -Encoding UTF8
# ① 审阅台整 P 铺开：每 SC 一卡（带定位锚），卡内 14 格竖排。
Assert-True ($directorPane.Contains('className="shot-cards"')) '审阅台未整 P 铺开（仍是单镜编辑器）'
Assert-True ($directorPane.Contains('data-shot={shot.id}')) 'SC 卡未暴露镜号锚（「全书清单」跳转与 e2e 都靠它定位）'
Assert-True ($directorPane.Contains('className="shot-card-head"')) 'SC 卡缺少卡头（标题行无处承载）'
# 卡头与导出标题行**同源**：`compiler.previewText` 写什么，卡片头就写什么，不新造字段。
Assert-True ($directorPane.Contains('【{shot.purpose || ''待确认''}｜{shot.duration}s】')) '卡头未采用标题行格式'
Assert-True ($compilerBody.Contains('【${shot.purpose || ''待确认''}｜${shot.duration}s】')) '导出标题行格式与本步卡头不再同源（判据漂移）'
# 三个只读位与 protectedKeys（character / scene / dialogue）一一对应：①② 来自资产、⑫ 来自原稿。
Assert-True ($directorPane.Contains('originOf')) '只读位缺少来源标（用户会以为「这格填不了是坏了」）'
Assert-True ($directorPane.Contains('资产') -and $directorPane.Contains('原稿')) '只读位来源标未按「资产 / 原稿」两类呈现'
Assert-True ($app.Contains('重新生成本 P')) '「重新生成本 P」未落地'
Assert-True (-not $app.Contains('shot-tabs')) '镜页签回流了（整 P 铺开后不应再有镜切换）'
Assert-True ($directorPane.Contains('aria-label="P 索引条"')) 'P 索引条缺少无障碍名'
# ② 单 P 重生的上下文取「上一段的**板上结果**」，不是空上下文 ——
#    否则该段会跳出整集影调与轴线（与整集路径「回退段也算上段结果」同一条纪律）。
Assert-True ($app.Contains('draftsOnBoard')) '单 P 重生未从板面取上段上下文'
Assert-True ($app.Contains('async function regenerateSegment')) '「重新生成本 P」的编排入口未落地'
# ③ 「成品与质检」面板**整体移除**（2026-10-06 老大裁定「这块不要了」）：右栏只剩导演板，
#    质检入口只留末端「全书清单」（`GatePanel`）。口径翻为**负向锁死** —— 负向断言比正向更严：
#    正向只拦「没做」，负向拦的是「又做回来了」，而回流的代价（右栏被 42% 高的面板切走、
#    以及「AI 态无校验卡」那套显示态收敛逻辑跟着复活）正是本次要避免的。
Assert-True (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'src/panes/ResultPane.tsx'))) '成品与质检面板文件回流了'
# 下面几条刻意锚在**代码形状**（import 路径 / JSX 标签 / 带括号的调用）而不是裸标识符上 ——
# 归档说明与代码注释里会**如实地**提到「已被移除的 `ResultPane`」「与 `compiler.previewText` 同源」，
# 裸标识符断言会把这类留痕误判成回流。
Assert-True (-not $app.Contains('panes/ResultPane')) '成品与质检面板的 import 回流了'
Assert-True (-not $app.Contains('<ResultPane')) '成品与质检面板的渲染接线回流了'
Assert-True (-not $app.Contains('previewText(')) '整集预览的编排残留回流了（面板已移除，右栏不再渲染预览）'
Assert-True (-not $app.Contains('setTab(')) '面板的页签状态回流了（面板已移除，不再有「本集校验 / 分镜预览」两个页签）'
Assert-True (-not $app.Contains('onTabIssues')) '闸门清单「跳转到本集校验」的接线回流了'
# ④ 校验口径**不受**本次界面收缩影响：本集校验数据仍由编排层持有（删界面 ≠ 删校验）——
#    顶栏导出按钮仍据 `errors` 给出「本集 N 项阻断」的提示文案，按集校验的防抖接线也一无所动。
Assert-True ($app.Contains('const errors = issues.filter')) '本集阻断计数被误删（顶栏导出提示会变哑）'
Assert-True ($app.Contains('scheduleValidation')) '按集校验的防抖接线被误删'
# ⑤ 样式：整 P 铺开的卡片、14 格竖排；面板移除后其**独占样式必须一并清掉**（否则是永远打不到的孤儿规则）。
Assert-True ($stylesBody.Contains('.shot-cards { display: flex; flex-direction: column;')) '审阅台卡片未竖向堆叠'
Assert-True ($stylesBody.Contains('.shot-cards .field-grid { grid-template-columns: 1fr; }')) '卡片内 14 格未竖排'
foreach ($dead in @('.result-pane', '.result-tabs', '.result-footer', '.review-row', '.issues-note', '.issue-badge')) {
    Assert-True (-not $stylesBody.Contains("$dead {")) "成品与质检面板的孤儿样式未清理：$dead"
}
# `.pane-title .error-count` / `.ready-count` 只服务已删面板的标题行（`GatePanel` 的计数样式归 `.gate-summary` 那一组）。
Assert-True (-not $stylesBody.Contains('.pane-title .error-count')) '已删面板的标题计数样式仍是孤儿规则'
# ⑥ 归档留痕（含方案第 4 行两处口径并读会互相矛盾的那处解读）。
foreach ($term in @('P 索引条', '整 P 铺开', 'draftsOnBoard', 'review-row', 'origin-tag')) {
    Assert-True ($p4UiBody.Contains($term)) "P4 第二小步 b 归档缺少证据：$term"
}

# ── 片段导出（2026-10-06）──────────────────────────────────────────────
# 段头新增「导出当前片段」+ Word / TXT 二选一。四条硬判据：
# ① 片段范围取值**单源** —— Word（`core/word.ts`）与 TXT（`compiler.previewText`）两条输出链路
#    各写一套过滤，早晚出现「Word 导一片、TXT 导整集」这种谁也说不清的错位；
# ② 编排入口存在，且**不得**接 `prepareForExport` —— 那个函数对整集跑规则生成再回填，
#    会把每一段（哪怕一条字段都没写进去）都挂上 `directorGenerated`，片段导出不该污染整集状态；
# ③ 闸门口径 = 本段 error ＋ **无 `segmentId` 的集级 error**（原稿层事实类）；
# ④ 归档两处登记。
$wordBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/word.ts') -Raw -Encoding UTF8
$modelBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/model.ts') -Raw -Encoding UTF8
Assert-True ($directorPane.Contains('导出当前片段')) '「导出当前片段」未落地'
Assert-True ($directorPane.Contains('aria-label="片段导出格式"')) '片段导出缺少 Word / TXT 二选一入口'
Assert-True ($app.Contains('async function exportSegment')) '片段导出的编排入口未落地'
Assert-True ($modelBody.Contains('export function segmentsOf')) '片段范围未单源（Word 与 TXT 会各写一套过滤）'
Assert-True ($wordBody.Contains('segmentsOf(episode, segmentId)')) 'Word 片段导出未走单源范围取值'
Assert-True ($compilerBody.Contains('segmentsOf(episode, segmentId)')) 'TXT 片段导出未走单源范围取值'
Assert-True ($compilerBody.Contains('!item.segmentId || item.segmentId === segmentId')) '片段闸门未区分「本段」与「集级事实类」错误'
$exportSegmentBody = [regex]::Match($app, 'async function exportSegment[\s\S]*?\n  \}').Value
Assert-True ($exportSegmentBody.Length -gt 0) '未能定位片段导出编排入口的函数体'
Assert-True (-not $exportSegmentBody.Contains('prepareForExport')) '片段导出接了 prepareForExport（会把整集补齐并把每段都标记「已生成」）'
$segmentExportArchive = '99_过程归档/2026-10-06_片段导出实施记录.md'
Assert-True ($nav.Contains($segmentExportArchive)) '导航未登记片段导出实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $segmentExportArchive)) '片段导出实施归档不存在'
$segmentExportBody = Get-Content -LiteralPath (Join-Path $projectRoot $segmentExportArchive) -Raw -Encoding UTF8
foreach ($term in @('导出当前片段', 'segmentsOf', 'prepareForExport')) {
    Assert-True ($segmentExportBody.Contains($term)) "片段导出归档缺少证据：$term"
}

# ── 移除「H3 成品与质检」面板（2026-10-06）────────────────────────────────
# 老大原话「这块不要了」：右栏末项（页签条 + 逐 P 对账行 + 本集问题清单 + 整集预览 + 底部入口）整体移除。
# 三条硬判据：① 面板与其独占样式**清干净**（不留孤儿规则）；② 校验口径**不跟着删**（删界面 ≠ 删校验）；
# ③ 归档两处登记。防回流的负向锁死写在上面的 P4 段，此处只锁交付物与判据词。
$removeResultArchive = '99_过程归档/2026-10-06_移除成品与质检面板实施记录.md'
Assert-True ($nav.Contains($removeResultArchive)) '导航未登记移除成品与质检面板实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $removeResultArchive)) '移除成品与质检面板实施归档不存在'
$removeResultBody = Get-Content -LiteralPath (Join-Path $projectRoot $removeResultArchive) -Raw -Encoding UTF8
foreach ($term in @('成品与质检', 'ResultPane', '负向锁死', 'previewText', '删界面 ≠ 删校验')) {
    Assert-True ($removeResultBody.Contains($term)) "移除成品与质检面板归档缺少证据：$term"
}

# ── 「道具」图类退役 + 老存档丢弃 + 资产下拉改造（2026-10-06）──────────────
# 老大原话：「把左边的输入图片改为下拉选择人物，场景；道具选区不要了」→ 追问后裁定
# 「连数据层一起退役」「老存档里的道具资产直接丢弃」。
# 关键判断：这是**结构性 schema 失配**（`kind` 的 enum 收成两类），`projectSchemaTolerant` 治不了 ——
# 老存档里只要有一张 `kind:'prop'`，两跳 `safeParse` 都会 strict 失败，而 `loadDraft` 会把失败
# 吞成「无存档」，用户的整份存档就此**静默消失**。故必须在解析**之前**归一化（`retirePropAssets`）。
$storageBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/storage.ts') -Raw -Encoding UTF8
Assert-True ($modelBody.Contains("z.enum(['character', 'scene'])")) '写入侧图类未收成两类（老存档的 prop 会整份读不进来）'
Assert-True ($modelBody.Contains("z.enum(['character', 'scene']).nullable()")) 'kindGuess 未收成「两类 + 可空」（判不出时不得硬塞一个类目）'
Assert-True ($migrateBody.Contains('function retirePropAssets')) '缺少解析前的道具资产归一（老存档会静默消失）'
Assert-True ($migrateBody.Contains('retirePropAssets(hoistEpisodeImages(raw))')) '道具归一未接在解析之前（顺序错了等于没做）'
Assert-True ($migrateBody.Contains('droppedPropImages')) '丢弃张数未上报（「可以丢，但不许静默丢」）'
Assert-True ($storageBody.Contains('droppedProps')) '载入结果未带出丢弃张数（界面无从提示）'
Assert-True ($app.Contains('state.droppedProps')) '界面未消费丢弃张数（丢了却不说，属静默失败）'
Assert-True ($app.Contains('张「道具」参考图')) '界面缺少「道具参考图已丢弃」的可见提示'
# ④ 构图回归「只写导演的构图」：道具退役后取值口不再拼接任何资产描述。
Assert-True (-not ($skeletonBody.Contains("image.kind === 'prop'"))) '④ 构图仍在拼接道具描述（道具已退役，取值口未同步）'
# 界面改版后**独占样式必须一并清掉**（否则是永远打不到的孤儿规则）。
foreach ($dead in @('.image-item', '.image-detail', '.image-use', '.image-remove', '.asset-groups')) {
    Assert-True (-not ($stylesBody.Contains("$dead {"))) "旧「每张卡一个编辑区 / 三框并列」的孤儿样式未清理：$dead"
}
$retireArchive = '99_过程归档/2026-10-06_道具图类退役与资产下拉改造实施记录.md'
Assert-True ($nav.Contains($retireArchive)) '导航未登记道具图类退役实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $retireArchive)) '道具图类退役实施归档不存在'
$retireBody = Get-Content -LiteralPath (Join-Path $projectRoot $retireArchive) -Raw -Encoding UTF8
foreach ($term in @('retirePropAssets', 'asset-picker', '下拉', '丢弃', 'structural')) {
    Assert-True ($retireBody.Contains($term)) "道具图类退役归档缺少证据：$term"
}

# ── 资产缩略图条（2026-10-10）────────────────────────────────────────────
# 老大报「会出现上传的图片再打开无法查看的情况」。实测（Playwright 走真实 UI）：导入后面板内
# `<img>` 数 = 0、手动从下拉选一张 = 1、重载后 = 0 —— 图在库里（存储层拆装实测可逆），
# 但界面看不到。根因：全应用只剩 `AssetPane.renderEditor` 一处渲染缩略图，而编辑区由**组件局部
# state `editing`** 控制（导入不设置、重载必为 null），下拉 `<option>` 与已选标签又只能放文字。
# 修法 = 每类补一条**始终可见**的 `.asset-strip` 缩略图条。三条防回流：
# ① 条的落点（`.asset-strip` + 类名 aria-label，且不得含「资产」二字与分组 aria-label 撞车）；
# ② 点一下仍走**唯一出口** `pickForSegment`；③ 条内的图必须限尺寸（不得按原分辨率撑破面板）。
Assert-True ($app.Contains('className="asset-strip"')) '资产缩略图条缺失（缩略图又只剩编辑区一处，导入后/重开后看不到图）'
Assert-True ($app.Contains('aria-label={`${kindName}缩略图条`}')) '缩略图条未暴露类名（合并折叠后只有一条，须按当前类能精确定位）'
Assert-True ($app.Contains('className={`asset-thumb')) '缩略图条缺少单张缩略图（点一下即选为本段并打开编辑区）'
Assert-True ($app.Contains('onClick={() => pickForSegment(image)}')) '缩略图条未复用唯一的选图出口（另起了一套选图语义）'
Assert-True ($stylesBody.Contains('.asset-strip {')) '缩略图条样式缺失'
Assert-True ($stylesBody.Contains('.asset-thumb img {')) '缩略图条的图未限制尺寸（会按原分辨率撑破面板）'
$thumbnailArchive = '99_过程归档/2026-10-10_资产缩略图条实施记录.md'
Assert-True ($nav.Contains($thumbnailArchive)) '导航未登记资产缩略图条实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $thumbnailArchive)) '资产缩略图条实施归档不存在'
$thumbnailBody = Get-Content -LiteralPath (Join-Path $projectRoot $thumbnailArchive) -Raw -Encoding UTF8
foreach ($term in @('asset-strip', 'pickForSegment', 'editing', '三态', '实测')) {
    Assert-True ($thumbnailBody.Contains($term)) "资产缩略图条归档缺少证据：$term"
}

# ── 资产区合并折叠（2026-10-19）────────────────────────────────────────────
# 老大原话：「点击出现人物和场景选项，选择哪个显示哪一部分的资产」。
# 两版原型被否（两张卡各自折叠 / 一个下拉混排全部选项），定稿为「一块面板 + 类别下拉」。
# 归档必须留下四件事，否则下次改动会重走这两条弯路：两版为何被否、四键为何不升级为全库、
# 缺口为何必须写进选中项、2A 的记忆范围（会话内、不落盘）。
$foldArchive = '99_过程归档/2026-10-19_资产区合并折叠与类别切换实施记录.md'
Assert-True ($nav.Contains($foldArchive)) '导航未登记资产区合并折叠实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $foldArchive)) '资产区合并折叠实施归档不存在'
$foldBody = Get-Content -LiteralPath (Join-Path $projectRoot $foldArchive) -Raw -Encoding UTF8
foreach ($term in @('asset-kind', 'kindOptionLabel', 'supplyStatsOf', 'editingByKind', 'pickForSegment', '会话内', '四键仍按类作用')) {
    Assert-True ($foldBody.Contains($term)) "资产区合并折叠归档缺少证据：$term"
}

# ── 「人物设定与弧光」按人物落盘（2026-10-06 第二步）──────────────────────
# 老大原话：「人物弧光界面只检测资产的人物名称并有相应的填写人物设定和人物弧光的文本框」；
# 追问后落定：只从**已上传的人物资产**派生 · 全本一份（每人一组）· 锚点保留在本节内 · 先只落盘。
# 四条硬判据：① 字段是 `visual.cast` 而不是 `characters`（后者与字符串锚点 `visual.character` 会看混）；
# ② 人物列表**只**派生自人物资产（`castNamesOf`，只读派生、不新存名册）；
# ③ 写它**不得**动 `visual.version` / `confirmed`（那两个描述的是固定锚点，不是文本）；
# ④ 锚点那半原样留在本节内。
Assert-True ($modelBody.Contains('cast: z.array(z.object({ name: z.string(), setting: z.string(), arc: z.string() })).default([])')) '缺少按人物字段 visual.cast（老存档缺这把键时必须靠 default 补空数组）'
Assert-True (-not ($modelBody.Contains('characters:'))) '按人物字段用了 characters（与字符串锚点 visual.character 会看混）'
Assert-True ($modelBody.Contains('export function castNamesOf')) '缺少人物列表派生（只读派生，不得新存一份名册）'
Assert-True ($castPane.Contains('castNamesOf(project.assets)')) '人物列表未从**人物资产**派生'
Assert-True ($castPane.Contains('aria-label={`${name}人物设定`}')) '缺少按人物的「人物设定」文本框'
Assert-True ($castPane.Contains('aria-label={`${name}人物弧光`}')) '缺少按人物的「人物弧光」文本框'
Assert-True ($castPane.Contains('aria-label="人物固定锚点"')) '锚点被移出「人物设定与弧光」节（老大 2026-10-06 裁定「锚点保留在本节内」）'
$storeBody4 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/store.ts') -Raw -Encoding UTF8
Assert-True ($storeBody4.Contains('updateCastNote(name, key, value)')) '缺少按人物写入实现'
# 写入口的**负向锁死**：按人物落盘与锚点状态是两件事，顺手 bump/清除就是语义污染。
$castNoteBody = [regex]::Match($storeBody4, 'updateCastNote\(name, key, value\) \{[\s\S]*?\n  \},').Value
Assert-True ($castNoteBody.Length -gt 0) '未能定位 updateCastNote 的函数体'
Assert-True (-not ($castNoteBody.Contains('version:'))) '按人物写入顺手改了 visual.version（锚点的版本状态被污染）'
Assert-True (-not ($castNoteBody.Contains('confirmed:'))) '按人物写入顺手清了 confirmed（填一个文本框会把锚点打回未确认）'
$castArchive = '99_过程归档/2026-10-06_按人物设定与弧光实施记录.md'
Assert-True ($nav.Contains($castArchive)) '导航未登记按人物设定与弧光实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $castArchive)) '按人物设定与弧光实施归档不存在'
$castBody = Get-Content -LiteralPath (Join-Path $projectRoot $castArchive) -Raw -Encoding UTF8
foreach ($term in @('castNamesOf', 'visual.cast', '只落盘', '人物弧光')) {
    Assert-True ($castBody.Contains($term)) "按人物设定与弧光归档缺少证据：$term"
}

# 私有接口地址防回流（2026-10-05 泄漏事故）：真实第三方中转域名曾被硬编码进测试文件与归档记录并推上远端。
# 判据：`src/` `electron/` `tests/` 里出现的 http(s) 主机，必须属于「保留域 / 本机回环 / 厂商注册表已登记」三类之一；
# 出现任何**未登记的真实域名**即判失败 —— 私有接口地址不得进仓库。（本段只堵代码侧；**文档层同口径已在本文件下方追加**。）
$allowedHosts = New-Object System.Collections.Generic.HashSet[string]
foreach ($h in @('127.0.0.1', 'localhost', 'www.w3.org')) { [void]$allowedHosts.Add($h) }
$providerText = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/ai-providers.ts') -Raw -Encoding UTF8
foreach ($m in [regex]::Matches($providerText, 'https://([A-Za-z0-9\.\-]+)')) { [void]$allowedHosts.Add($m.Groups[1].Value.ToLower()) }
$codeFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src') -Recurse -File | Where-Object { $_.Extension -in '.ts', '.tsx' }
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'electron') -Recurse -File | Where-Object { $_.Extension -in '.ts', '.cts' }
    # ★ 含 `.ps1`：本轮真实发生过「契约测试自身的注释里写了私有地址」，而 `.ps1` 原来既不在代码侧
    #   （只含 .ts/.tsx/.cts）、也不在文档层（只含 .md）—— 是两头都不管的盲区。
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests') -Recurse -File | Where-Object { $_.Extension -in '.ts', '.ps1' }
)
$badHosts = @()
$localLoopPorts = New-Object System.Collections.Generic.HashSet[string]
foreach ($f in $codeFiles) {
    $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
    foreach ($m in [regex]::Matches($text, 'https?://([A-Za-z0-9\.\-]+)')) {
        $h = $m.Groups[1].Value.ToLower().TrimEnd('.')
        # 保留域（RFC 2606 / 6761）：.test / .example / .invalid / .localhost 及 example.com|net|org
        if ($h -match '\.(test|example|invalid|localhost)$') { continue }
        if ($h -match '(^|\.)example\.(com|net|org)$') { continue }
        if ($allowedHosts.Contains($h)) { continue }
        $badHosts += "$($f.Name):$h"
    }
    # 本机服务端口白名单的**唯一来源** = 代码里真实出现的 `127.0.0.1:<port>`（Ollama 11434 / LM Studio 1234 /
    # Vite 5173 等），**不在此处枚举端口**。文档层若出现代码里没有的本机端口，即视为把手填的私有配置
    # （如本机代理端口）抄进了文档。
    foreach ($m in [regex]::Matches($text, '(127\.0\.0\.1|localhost):([0-9]{2,5})')) { [void]$localLoopPorts.Add($m.Value.ToLower()) }
}
foreach ($cfg in @('package.json', 'playwright.config.ts', 'vitest.config.ts', 'index.html')) {
    $cfgPath = Join-Path $projectRoot $cfg
    if (Test-Path -LiteralPath $cfgPath) {
        $cfgText = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8
        foreach ($m in [regex]::Matches($cfgText, '(127\.0\.0\.1|localhost):([0-9]{2,5})')) { [void]$localLoopPorts.Add($m.Value.ToLower()) }
    }
}
$badList = ($badHosts | Sort-Object -Unique) -join ', '
Assert-True ($badHosts.Count -eq 0) "代码/测试中出现未登记的 URL 主机（疑似私有接口地址流入仓库）：$badList"

# ── 同口径扩到文档层（2026-10-06 二次泄漏收口）────────────────────────────────
# 背景：2026-10-05 的护栏只扫代码侧（旧注释自认「归档文档层无法自动判」），2026-10-06 的归档 /
# 技术方案 / 导航三处文档又把私有上游地址原文抄了进去 —— 私有域名 `host:443` ×5、
# 带协议前缀的私有域名 ×1、本机代理 `127.0.0.1:<port>` ×2，共 8 处。本段把同一套白名单判据扩到文档层。
# ★ 判据形态**必须收窄**：本项目文档高频使用「文件:行号」引用（`planner.ts:145`），照搬「裸域名」
#   判据会全量假红（实测文档层裸点分标识符 200+ 条，其中真域名只有 3 个）。于是只用两条高精度判据：
#   ① `协议://host`             → host 走白名单；
#   ② `host:端口`（host 必须含点）→ host 走白名单；**host 以源文件扩展名或纯数字结尾的直接跳过**
#      （前者是「文件:行号」引用，后者是版本号 `v1.1:154` 这类）；本机回环则要求 `host:端口`
#      在代码侧真实出现过（堵住把**手填的本机代理端口**抄进文档）。
# 残余盲区（如实记录，靠人工复核）：不带协议前缀、不带端口的裸域名（如 `api.xxx.xyz/v1`）无法与
#   代码标识符（`visual.cast`）区分，本护栏不覆盖 —— 本次 8 处全部落在上面两条判据内（已实测）。
$docFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $projectRoot '00_索引') -Recurse -File -Filter '*.md'
    Get-ChildItem -LiteralPath (Join-Path $projectRoot '01_产品方案') -Recurse -File -Filter '*.md'
    Get-ChildItem -LiteralPath (Join-Path $projectRoot '02_技术方案') -Recurse -File -Filter '*.md'
    Get-ChildItem -LiteralPath (Join-Path $projectRoot '99_过程归档') -Recurse -File -Filter '*.md'
    Get-Item -LiteralPath (Join-Path $projectRoot 'agents.md')
)
$srcExtensions = @('md', 'ts', 'tsx', 'js', 'mjs', 'cjs', 'cts', 'json', 'html', 'css', 'ps1', 'yaml', 'yml',
    'png', 'jpg', 'jpeg', 'svg', 'txt', 'lock', 'log', 'env', 'vue', 'scss', 'less', 'mdx', 'toml', 'ini',
    'cfg', 'xml', 'db', 'sqlite')
$badDocHosts = @()
foreach ($f in $docFiles) {
    $text = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
    # 判据①：带协议前缀的真实域名
    foreach ($m in [regex]::Matches($text, '[a-z][a-z0-9+.\-]*://([A-Za-z0-9\.\-]+)')) {
        $h = $m.Groups[1].Value.ToLower().TrimEnd('.')
        if ($h -match '\.(test|example|invalid|localhost)$') { continue }
        if ($h -match '(^|\.)example\.(com|net|org)$') { continue }
        if ($allowedHosts.Contains($h)) { continue }
        $badDocHosts += "$($f.Name):$h"
    }
    # 判据②：`host:端口`（host 必须含点；排除「文件:行号」与版本号形态）
    foreach ($m in [regex]::Matches($text, '([A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+):([0-9]{2,5})')) {
        $h = $m.Groups[1].Value.ToLower().TrimEnd('.')
        # 版本号形态（`v1.1` / `1.8.0` / `9.30`）：文档里指代方案文件的编号引用，跳过。
        # ★ 此处**不能**用「末段是数字就跳过」的简化判据 —— 那会连带跳过 IP（`127.0.0.1` / `192.168.1.5`），
        #   而「手填的本机代理端口」正是本次要堵的形态之一（实测漏报过一次）。必须按「段数 ≤3 的版本号」精确排除。
        if ($h -match '^v?[0-9]+(\.[0-9]+){1,2}$') { continue }
        # 「文件:行号」引用：host 以源文件扩展名结尾
        if ($srcExtensions -contains ($h -split '\.')[-1]) { continue }
        # 本机回环：要求 `host:端口` 在代码侧真实出现过（代码里没这个端口 = 是手填的私有配置）
        if ($h -eq '127.0.0.1' -or $h -eq 'localhost') {
            if (-not $localLoopPorts.Contains("${h}:$($m.Groups[2].Value)")) { $badDocHosts += "$($f.Name):${h}:$($m.Groups[2].Value)" }
            continue
        }
        if ($h -match '\.(test|example|invalid|localhost)$') { continue }
        if ($h -match '(^|\.)example\.(com|net|org)$') { continue }
        if ($allowedHosts.Contains($h)) { continue }
        $badDocHosts += "$($f.Name):$h"
    }
}
$badDocList = ($badDocHosts | Sort-Object -Unique) -join ', '
Assert-True ($badDocHosts.Count -eq 0) "文档层出现未登记的 URL 主机（疑似私有接口地址流入归档 / 方案 / 导航）：$badDocList"

# 文档层私有地址脱敏与护栏扩展（2026-10-06）：老大「上传最新版本，禁止上传 key，url，其他本地缓存，
# 检索完没问题后再上传」的收口归档 —— 记下本护栏自身的判据设计依据、真漏报修正与真护栏验证证据。
$redactArchive = '99_过程归档/2026-10-06_文档层私有地址脱敏与护栏扩展实施记录.md'
Assert-True ($nav.Contains($redactArchive)) '导航未登记文档层私有地址脱敏与护栏扩展归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $redactArchive)) '文档层私有地址脱敏与护栏扩展归档不存在'
$redactBody = Get-Content -LiteralPath (Join-Path $projectRoot $redactArchive) -Raw -Encoding UTF8
foreach ($term in @('源文件扩展名', '本机回环', '残余盲区', '真护栏验证', 'Invalid preceding regular expression')) {
    Assert-True ($redactBody.Contains($term)) "文档层脱敏归档缺少证据：$term"
}

# Skill 模块落地与双引擎分治施工方案（2026-10-05）：把技术方案 v1.0 第 8 章「Skill 可拆卸、可更新、
# 可回滚」从设计落成实现 —— skill 包规范（`resources/skills/<domain>/<skillId>/<version>/` + `meta.json`
# + `sourceSha256` 溯源锚）、主进程 `SkillManager` 加载链路与降级、双引擎 L0/L1/L2 三层分治与七项适配、
# 界面「一具壳 + 两个引擎」同构、`App.tsx` 拆壳与 P0–P5 分期。**定性 U 而非 D**。
# 上游实证：`resources/` 目录在磁盘上不存在（skill 包从未落盘）；`director.ts:10-11` 明记「技能不在
# 运行时读取」；AI 侧规则现为 `electron/script.ts:35-49` 的硬编码 10 条常量。
$skillPlan = '02_技术方案/v1.1_Skill模块落地与双引擎分治施工方案.md'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $skillPlan)) 'Skill 施工方案文件不存在'
Assert-True ($nav.Contains('../' + $skillPlan)) '导航未指向 Skill 施工方案'
$skillPlanBody = Get-Content -LiteralPath (Join-Path $projectRoot $skillPlan) -Raw -Encoding UTF8
foreach ($term in @(
        'resources/skills', 'meta.json', 'sourceSha256', 'SkillManager', 'SKILL.md',
        'rules.json', 'prompt.md', '技能不在运行时读取', 'U 而非 D',
        '一具壳 + 两个引擎', 'mergeDrafts', 'P0', 'P5'
    )) {
    Assert-True ($skillPlanBody.Contains($term)) "Skill 施工方案缺少契约：$term"
}
Assert-True ($skillPlanBody.Contains('待批准')) 'Skill 施工方案未声明「待批准」状态（会被误当已开工）'
# 老大 2026-10-05 两条裁定：① UI 以最后定稿为准 → 资产区**三框并列**（推翻同日中间态的
# 「单入口 + 弹出小框」）；② **资产线与剧本线互通** —— 分开呈现但数据层共享连接键（人名 / 场景名）。
Assert-True ($skillPlanBody.Contains('三框并列')) 'Skill 施工方案未登记资产区「三框并列」定稿（会退回单入口小框）'
Assert-True ($skillPlanBody.Contains('互通')) 'Skill 施工方案未登记「资产线与剧本线互通」裁定'
Assert-True ($skillPlanBody.Contains('asset-kind-menu')) 'Skill 施工方案未登记资产三框改造须同步删改的既有断言（施工时会撞红 test:docs）'
# 首版范围裁定（2026-10-05）：**只做短剧**（剧型路由包不装载）+ **只装 MiniMax 专项包**
# （唯一入口 `minimax-h3-video-prompt`，四个依赖按 manifest 自动解析、界面不单独列出）。
# 边界：`contentTypes` 枚举**不动** —— 收窄枚举会让存量存档 strict 解析失败。
Assert-True ($skillPlanBody.Contains('只做短剧')) 'Skill 施工方案未登记「首版只做短剧」裁定'
Assert-True ($skillPlanBody.Contains('唯一入口')) 'Skill 施工方案未登记「唯一入口 = minimax-h3-video-prompt」'
Assert-True ($skillPlanBody.Contains('contentTypes')) 'Skill 施工方案未登记「剧型枚举不动」的边界（会误改 model.ts 撞存量存档）'
Assert-True ($nav.Contains('Skill 模块与双引擎分治')) '导航分类表未登记 Skill 模块与双引擎分治'

# P0 拆壳（2026-10-05）：`src/App.tsx` 由 1047 行单文件拆为「编排层 + panes 视图」。
# 拆壳的硬约束是**外观与行为零变化**，因此本段只锁「拆到哪」与「零变化的证法」，
# 界面断言仍由上面读 `$app`（渲染层合并文本）的那些条目把关。
$p0Archive = '99_过程归档/2026-10-05_P0拆壳实施记录.md'
Assert-True ($nav.Contains($p0Archive)) '导航未登记 P0 拆壳实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $p0Archive)) 'P0 拆壳实施归档不存在'
$p0Body = Get-Content -LiteralPath (Join-Path $projectRoot $p0Archive) -Raw -Encoding UTF8
foreach ($term in @('src/App.tsx', '1047', 'AssetPane', 'DirectorPane', 'ResultPane', 'SettingsPanel', 'GatePanel', 'EpisodePicker', 'labels.ts', '零变化')) {
    Assert-True ($p0Body.Contains($term)) "P0 拆壳归档缺少证据：$term"
}
# 拆壳产物清单：`ResultPane.tsx` 已于 2026-10-06（「这块不要了」）随面板整体删除，故不在此列表
# —— 它的「不得回流」由上面 P4 段的负向锁死把关，两处不重复承担同一件事。
foreach ($pane in @('AssetPane.tsx', 'DirectorPane.tsx', 'SettingsPanel.tsx', 'GatePanel.tsx', 'EpisodePicker.tsx', 'labels.ts')) {
    Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot "src/panes/$pane")) "拆壳后的 pane 文件不存在：$pane"
}

# P1 判据 JSON 化（2026-10-06）：L0 判据收拢到内置默认包；`rules.ts` / `skeleton.ts` 只做再导出。
# 闸门表与禁词表的「本体在哪」已由上面的闸门分级段断言（指向 skill-default.ts）把关，本段只锁交付物与判据词。
$p1Archive = '99_过程归档/2026-10-06_P1判据JSON化实施记录.md'
Assert-True ($nav.Contains($p1Archive)) '导航未登记 P1 判据 JSON 化实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $p1Archive)) 'P1 判据 JSON 化实施归档不存在'
$p1Body = Get-Content -LiteralPath (Join-Path $projectRoot $p1Archive) -Raw -Encoding UTF8
foreach ($term in @('skill-default.ts', 'transitionForbiddenWords', 'transitionTemplates', 'skeletonFields', 'issuePolicy', '210 passed', 'rootDir')) {
    Assert-True ($p1Body.Contains($term)) "P1 判据 JSON 化归档缺少证据：$term"
}
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'tests/unit/skill-default.test.ts')) 'P1 逐词比对单测不存在'

# P2 加载器接线（2026-10-06）：主进程 SkillManager + IPC + 渲染层加载与降级。
# 本期只做「读取与对账」，**不做「切换供源」**（生效判据仍取内置默认包，`useDiskRules` 归 P3 翻开关），
# 故本段只锁「链路是否接通」与「降级/校验两条判据是否登记」，不锁任何行为变更。
$p2Archive = '99_过程归档/2026-10-06_P2加载器接线实施记录.md'
Assert-True ($nav.Contains($p2Archive)) '导航未登记 P2 加载器接线实施归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $p2Archive)) 'P2 加载器接线实施归档不存在'
$p2Body = Get-Content -LiteralPath (Join-Path $projectRoot $p2Archive) -Raw -Encoding UTF8
foreach ($term in @('SkillManager', 'skills:catalog', 'skills:load', 'loadCatalog', 'loadSkill', 'verifySkill', '降级', '行为零变化', '28 项')) {
    Assert-True ($p2Body.Contains($term)) "P2 加载器接线归档缺少证据：$term"
}
foreach ($file in @(
    'electron/skills/manager.ts', 'electron/skills/schema.ts',
    'src/platforms/minimax-h3/skills.ts', 'resources/skills/catalog.json'
)) {
    Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $file)) "P2 交付物不存在：$file"
}
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot 'tests/unit/skill-packages.test.ts')) 'P2 加载器验收单测不存在'

# 换行锁：`resources/skills/**` 的 `SKILL.md` 参与 SHA-256 溯源锚校验，任何换行归一化都会让
# 全部包哈希失配并静默降级到内置默认判据。这条断言不做到，跨机器 clone 后就会莫名其妙「包没生效」。
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot '.gitattributes')) '换行锁 .gitattributes 不存在'
$gitAttributes = Get-Content -LiteralPath (Join-Path $projectRoot '.gitattributes') -Raw -Encoding UTF8
Assert-True ($gitAttributes.Contains('resources/skills/** -text')) '.gitattributes 未锁定 skill 包换行（-text）'

# P3 双引擎分治（2026-10-06）：**第一段「行为有变化」的施工期**。七项适配 + 双写退役。
# 本段锁三件事：① 交付物在不在；② 判据词是否登记（供源翻转 / 四态分流 / 人名防幻觉 / 上下文不截断）；
# ③ 原「双写护栏」的替代正断言是否落地（两侧读同一份 rules.json）。
$p3Archive = '99_过程归档/2026-10-06_P3双引擎分治实施记录.md'
Assert-True ($nav.Contains($p3Archive)) '导航未登记 P3 双引擎分治实施归档'
Assert-True ($nav.Contains('P3 双引擎分治已完成')) '导航的 Skill 施工方案状态行未推进到 P3 完成'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $p3Archive)) 'P3 双引擎分治实施归档不存在'
$p3Body = Get-Content -LiteralPath (Join-Path $projectRoot $p3Archive) -Raw -Encoding UTF8
foreach ($term in @(
        'feeds.ts', 'useDiskRules', '双写退役', 'mergeDrafts', '四态', 'foreignNamesIn',
        '上下文不截断', 'arc', 'episodeSource', '246 passed', '25 passed', '正向断言', '行为有变化'
    )) {
    Assert-True ($p3Body.Contains($term)) "P3 双引擎分治归档缺少证据：$term"
}
foreach ($file in @(
    'electron/skills/feeds.ts'
)) {
    Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $file)) "P3 交付物不存在：$file"
}
# 供源翻转的硬证据：渲染层开关已翻 true，且取值层（规则出口）确实改读生效值而不是内置兜底。
$skillsBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/skills.ts') -Raw -Encoding UTF8
Assert-True ($skillsBody.Contains('const useDiskRules: boolean = true;')) 'P3 未翻转供源开关（useDiskRules 仍为 false）'
$rulesBody3 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/platforms/minimax-h3/rules.ts') -Raw -Encoding UTF8
Assert-True ($rulesBody3.Contains('export function activeForbiddenWords')) 'rules.ts 未提供生效禁词取值口（activeForbiddenWords）'
Assert-True ($rulesBody3.Contains('export function activeForbiddenPattern')) 'rules.ts 未提供生效禁词正则（activeForbiddenPattern）'
# 双写退役的替代断言：原「两份表逐词一致」改为「两侧读同一份 rules.json」。
$workbenchBody3 = Get-Content -LiteralPath (Join-Path $projectRoot 'tests/unit/workbench.test.ts') -Raw -Encoding UTF8
Assert-True ($workbenchBody3.Contains('两侧读同一份 rules.json')) 'P3 未落地双写退役的正向断言（两侧读同一份 rules.json）'
Assert-True ($workbenchBody3.Contains('foreignNamesIn')) 'P3 未落地人名防幻觉判据用例'
$storeBody3 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/store.ts') -Raw -Encoding UTF8
Assert-True (-not $storeBody3.Contains("key === 'action' || key === 'performance' || key === 'sound' ? sourceFields[key]")) 'P3 未撕掉「⑩⑪⑬ 无条件收敛回本地证据」的旧写法'

# 「已生成」标记语义修正（2026-10-06）：段级标记由「被生成动作扫过即为真」（硬编码）改为**派生值**。
# 负向锁**锚代码形状**（带分号的赋值语句），不锚裸标识符 —— 注释与归档会如实写「旧写法把布尔硬编码为真」，
# 裸标识符断言会把这类留痕误判成回流（锚点纪律见 2026-10-06_移除成品与质检面板实施记录.md）。
$generatedArchive = '99_过程归档/2026-10-06_已生成标记语义修正实施记录.md'
Assert-True ($nav.Contains($generatedArchive)) '导航未登记「已生成」标记语义修正归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $generatedArchive)) '「已生成」标记语义修正归档不存在'
$generatedBody = Get-Content -LiteralPath (Join-Path $projectRoot $generatedArchive) -Raw -Encoding UTF8
foreach ($term in @('isSegmentGenerated', 'const marked = true;', 'prepareForExport', '新标记', 'e2e')) {
    Assert-True ($generatedBody.Contains($term)) "「已生成」标记语义修正归档缺少证据：$term"
}
$modelBody5 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/model.ts') -Raw -Encoding UTF8
Assert-True ($modelBody5.Contains('export function isSegmentGenerated')) '「已生成」判据未落在 core/model.ts（判据必须单源）'
Assert-True ($modelBody5.Contains('return segment.shots.some((shot) => !!shot.draftSource);')) '「已生成」判据未按「本段至少一镜带来源标记」实现'
$storeBody5 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/store.ts') -Raw -Encoding UTF8
Assert-True (-not ($storeBody5.Contains('const marked = true;'))) '「扫过即已生成」的硬编码回流（段级标记必须由 isSegmentGenerated 派生）'
Assert-True ($storeBody5.Contains('isSegmentGenerated({ ...segment, shots })')) 'store 未按派生值回写段级标记'
Assert-True ($storeBody5.Contains('if (marked && !segment.directorGenerated) counter.segments += 1;')) '生成段数未改为「本次新标记段数」（界面话术会重复报数）'
$directorBody5 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/panes/DirectorPane.tsx') -Raw -Encoding UTF8
Assert-True ($directorBody5.Contains('isSegmentGenerated(item)')) '导演板未读派生判据（旧布尔会让幻影标记继续显示）'
Assert-True (-not ($directorBody5.Contains('item.directorGenerated'))) '导演板又直接读了段级布尔（判定与显示必须同源）'
$storeTestBody5 = Get-Content -LiteralPath (Join-Path $projectRoot 'tests/unit/store.test.ts') -Raw -Encoding UTF8
Assert-True ($storeTestBody5.Contains('被生成动作扫过、但没有一条字段写入的段不得挂「已生成」')) '缺少「扫过但零写入不挂标」的回归用例'

# AI 回填改写边界与失败可见化（2026-10-06）：老大「为什么 AI 推理后与本地一键生成的一模一样」的根因收口。
# 三层根因：① 上游接口不通（环境，不在契约内）；② 回填层「仅补空白」把 AI 出稿整条跳过（本节锁）；
# ③ 失败原因被空捕获 + 只回 fetch failed 一并吞掉（本节锁）。负向锁仍锚「代码形状」，不锚裸标识符。
$boundaryArchive = '99_过程归档/2026-10-06_AI回填边界与失败可见化实施记录.md'
Assert-True ($nav.Contains($boundaryArchive)) '导航未登记 AI 回填边界与失败可见化归档'
Assert-True (Test-Path -LiteralPath (Join-Path $projectRoot $boundaryArchive)) 'AI 回填边界与失败可见化归档不存在'
$boundaryBody = Get-Content -LiteralPath (Join-Path $projectRoot $boundaryArchive) -Raw -Encoding UTF8
foreach ($term in @('aiTakeover', 'protectedShots', 'UND_ERR_CONNECT_TIMEOUT', 'prepareForExport', 'errorNote')) {
    Assert-True ($boundaryBody.Contains($term)) "AI 回填边界归档缺少证据：$term"
}
$storeBody6 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/store.ts') -Raw -Encoding UTF8
Assert-True ($storeBody6.Contains("const aiTakeover = draft.source === 'ai' && !next.locked && next.draftSource !== 'manual';")) 'AI 出稿的改写边界被移除（会退回「AI 出稿被仅补空白逐条跳过」）'
Assert-True ($storeBody6.Contains('counter.protectedShots += 1;')) 'protectedShots 计数被移除（0 条字段时界面说不清原因）'
$appBody6 = Get-Content -LiteralPath (Join-Path $projectRoot 'src/App.tsx') -Raw -Encoding UTF8
Assert-True ($appBody6.Contains('function errorNote(')) 'AI 失败原因未归一化（失败原因会再次被吞）'
Assert-True ($appBody6.Contains('function failureNoteOf(')) '失败原因未汇总进提示条（失败仍然不可见）'
Assert-True (([regex]::Matches($appBody6, 'failures\.push\(errorNote\(error\)\)')).Count -eq 3) '失败原因的收集点不足三处（单集 / 选集段级 / 选集集级缺一）'
$clientBody = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/ai-client.ts') -Raw -Encoding UTF8
Assert-True ($clientBody.Contains('cause?.code')) 'describeNetworkError 又丢掉了 cause（只剩 fetch failed，排查无从下手）'
$storeTestBody6 = Get-Content -LiteralPath (Join-Path $projectRoot 'tests/unit/store.test.ts') -Raw -Encoding UTF8
Assert-True ($storeTestBody6.Contains('AI 出稿不受「覆盖已有内容」开关拦下')) '缺少「AI 出稿不受覆盖开关约束」的回归用例'
Assert-True ($storeTestBody6.Contains('如实回传 protectedShots')) '缺少 protectedShots 的回归用例'
Assert-True ($storeTestBody6.Contains('④ 构图不再被本地构图顶替')) '缺少「AI 稿不被本地构图顶替」的回归用例'

Write-Output 'PASS: 方案契约、14字段、15秒示例、9.30升级方案、闸门分级、产品方案 v1.1、技术架构、导入载荷分流、站位姓名与剧情设计生成、音效空间底噪与单源化清理、正文误判台词与场景光源派生、说话人命名与场次轴线锚、衔接按证据选型、一致性审计通用化、景别档位随入画人数校正、段内时长分配、AI 主路径依次推理、通用 AI 接入层与密钥自动常驻、生成按钮随 AI 就绪换形态与选集生成、生成分片与暂停、分集前置集保留、Skill 模块与双引擎分治施工方案（P0/P1/P2/P3 与换行锁、P4 第一小步资产三框、第二小步 a 两栏界面与第二小步 b 整 P 审阅台）、道具图类退役与资产下拉改造、按人物设定与弧光落盘、私有接口地址防回流（代码侧 + 文档层同口径）、已生成标记派生单源、AI 回填改写边界与失败可见化、资产缩略图条、资产区合并折叠与类别切换、导航已验证。'
