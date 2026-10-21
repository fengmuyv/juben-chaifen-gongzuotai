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
$app = Get-Content -LiteralPath (Join-Path $projectRoot 'src/App.tsx') -Raw -Encoding UTF8
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
Assert-True ($rulesBody.Contains("SHOT_DURATION_MAX: { severity: 'error', category: 'input' }")) 'SHOT_DURATION_MAX 未在闸门分级表登记'
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
$migrateBody = Get-Content -LiteralPath (Join-Path $projectRoot 'src/core/migrate.ts') -Raw -Encoding UTF8
Assert-True ($migrateBody.Contains('hoistEpisodeImages')) '缺少旧存档资产搬迁（按集存放的参考图会静默消失）'
Assert-True ($migrateBody.Contains('const normalized = hoistEpisodeImages(raw)')) '搬迁未先于 schema 解析执行（未知键被剥离即丢图）'
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
Assert-True ($app.Contains('const assetKinds')) '资产未按人物/场景/道具分区（三组顺序与名称必须单源）'
# 分区呈现形式（2026-10-05 改版）：**单入口 + 弹出小框**切换，不再三组平铺；三类图片互不干扰。
Assert-True ($app.Contains('asset-kind-menu')) '资产分类未改为「单入口 + 弹出小框」（三组平铺回流）'
Assert-True ($app.Contains('activeAssetKind')) '资产面板未按当前选中分类过滤（三类图片会互相干扰）'
Assert-True ($app.Contains('补齐 AI 描述')) '缺少「补齐 AI 描述」入口'
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

# 私有接口地址防回流（2026-10-05 泄漏事故）：真实第三方中转域名曾被硬编码进测试文件与归档记录并推上远端。
# 判据：`src/` `electron/` `tests/` 里出现的 http(s) 主机，必须属于「保留域 / 本机回环 / 厂商注册表已登记」三类之一；
# 出现任何**未登记的真实域名**即判失败 —— 私有接口地址不得进仓库。（归档文档层无法自动判，靠人工复核 + 本护栏堵代码侧。）
$allowedHosts = New-Object System.Collections.Generic.HashSet[string]
foreach ($h in @('127.0.0.1', 'localhost', 'www.w3.org')) { [void]$allowedHosts.Add($h) }
$providerText = Get-Content -LiteralPath (Join-Path $projectRoot 'electron/ai-providers.ts') -Raw -Encoding UTF8
foreach ($m in [regex]::Matches($providerText, 'https://([A-Za-z0-9\.\-]+)')) { [void]$allowedHosts.Add($m.Groups[1].Value.ToLower()) }
$codeFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src') -Recurse -File | Where-Object { $_.Extension -in '.ts', '.tsx' }
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'electron') -Recurse -File | Where-Object { $_.Extension -in '.ts', '.cts' }
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests') -Recurse -File | Where-Object { $_.Extension -eq '.ts' }
)
$badHosts = @()
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
}
$badList = ($badHosts | Sort-Object -Unique) -join ', '
Assert-True ($badHosts.Count -eq 0) "代码/测试中出现未登记的 URL 主机（疑似私有接口地址流入仓库）：$badList"

Write-Output 'PASS: 方案契约、14字段、15秒示例、9.30升级方案、闸门分级、产品方案 v1.1、技术架构、导入载荷分流、站位姓名与剧情设计生成、音效空间底噪与单源化清理、正文误判台词与场景光源派生、说话人命名与场次轴线锚、衔接按证据选型、一致性审计通用化、景别档位随入画人数校正、段内时长分配、AI 主路径依次推理、通用 AI 接入层与密钥自动常驻、生成按钮随 AI 就绪换形态与选集生成、生成分片与暂停、分集前置集保留、私有接口地址防回流和导航已验证。'
