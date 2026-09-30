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
    '微表情', '台词 / 内心OS', '音效', '衔接'
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

Write-Output 'PASS: 方案契约、14字段、15秒示例、9.30升级方案、产品方案 v1.1、技术架构和导航已验证。'
