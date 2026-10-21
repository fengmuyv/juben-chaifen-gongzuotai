import { describe, expect, it } from 'vitest';
import {
  h3CompileAllowedKeys, ignorableIssueCategories, issueCategoryNames, issuePolicy,
  segmentTailTransition, skeletonFields, skeletonGeneratedKeys, skeletonProtectedKeys,
  transitionForbiddenWords, transitionPositivePool, transitionRequiredShape, transitionTemplates,
} from '../../src/platforms/minimax-h3/skill-default';
import {
  issuePolicy as rulesIssuePolicy, transitionForbiddenPattern,
  transitionForbiddenWords as rulesForbiddenWords,
} from '../../src/platforms/minimax-h3/rules';
import { fields, generatedKeys, protectedKeys } from '../../src/platforms/minimax-h3/skeleton';
import { transitionPool } from '../../src/platforms/minimax-h3/director';

/**
 * P1 · 判据 JSON 化验收：**逐词比对「抽包前 → 抽包后」完全一致**（施工方案 §7 P1 判据）。
 *
 * 关键纪律：**期望值一律以字面量写在本文件里**，不得从默认包读出来再与默认包自己比 ——
 * 那样搬运时抄错一个词，断言会跟着一起错、永远保持绿色。这里每一串都是「抽包前源码里的原文」。
 */

describe('P1 判据 JSON 化：内置默认包与原硬编码逐词一致', () => {
  it('⑭ 衔接禁词 27 条：逐词、逐序与抽包前一致', () => {
    expect([...transitionForbiddenWords]).toEqual([
      // 黑 / 白场类
      '渐黑', '渐白', '黑屏', '黑场', '白屏', '白场', '闪黑', '闪白',
      // 溶解叠化类
      '叠化', '交叉溶解', '溶解', '淡入', '淡出', '淡入淡出',
      // 推拉摇移类（仅当作为「转场手段」使用时）
      '推镜转场', '拉镜转场', '推拉转场', '摇镜转场', '移镜转场', '单纯推', '单纯拉', '单纯摇', '单纯移',
      // 定格 / 锁帧类
      '定格转场', '定格收尾', '锁帧', '冻结画面',
    ]);
    expect(transitionForbiddenWords).toHaveLength(27);
  });

  it('禁词正则由词表构造（正则与数组永不脱节）', () => {
    expect(transitionForbiddenPattern.source).toBe(transitionForbiddenWords.join('|'));
  });

  it('不误伤 ④ 运镜的正常推拉摇移（用组合词而非光秃的 推/拉/摇/移）', () => {
    for (const text of ['缓慢推近', '镜头极缓拉远', '横向移动跟随', '轻微摇镜']) {
      expect(transitionForbiddenPattern.test(text)).toBe(false);
    }
    for (const text of ['以单纯推完成转场', '此处叠化过渡', '闪黑切场']) {
      expect(transitionForbiddenPattern.test(text)).toBe(true);
    }
  });

  it('合规衔接短名池 11 条：逐词、逐序与抽包前一致', () => {
    expect([...transitionPositivePool]).toEqual([
      '动作接动作', '视线引导', '遮挡转场', '匹配剪辑', 'J-Cut', 'L-Cut',
      '声音先入', '空镜缓冲', '同向运动顺接', '光影变化接', '焦点转移接',
    ]);
  });

  it('成稿形态要求文案未被改写', () => {
    expect(transitionRequiredShape).toBe('衔接须写明手段 + 匹配的具体元素');
  });

  it('⑭ 成稿文案池 11 条：逐字与抽包前一致、无重复、与短名池一一对应', () => {
    expect([
      transitionTemplates.actionMatch, transitionTemplates.eyeLine, transitionTemplates.occlusion,
      transitionTemplates.matchCut, transitionTemplates.jCut, transitionTemplates.lCut,
      transitionTemplates.soundLead, transitionTemplates.emptyBuffer, transitionTemplates.sameDirection,
      transitionTemplates.lightShift, transitionTemplates.focusShift,
    ]).toEqual([
      '动作接动作：本镜末的抬手动作接下一镜同一动作的继续，动势方向保持一致',
      '视线引导：本镜末人物视线落向画面一侧，下一镜顺视线方向切到目标物',
      '遮挡转场：前景遮挡体自画面一侧扫入并覆盖至满幅（满幅峰值保持不少于 8 帧），在遮蔽峰值处完成换景，遮挡体沿同一方向退出后显露新空间，落点恢复至新场次的稳定构图',
      '匹配剪辑：以前景物体的轮廓匹配下一镜的同形物体，形状与画面位置对齐',
      'J-Cut：下一镜的环境声与对话先于画面进入，本镜画面仍在延续',
      'L-Cut：本镜台词延续到下一镜画面，用声音搭桥完成空间切换',
      '声音先入：下一镜的脚步声中先于画面出现，形成听觉预期',
      '空镜缓冲：插入一段空间空镜，承接情绪后再回到人物',
      '同向运动顺接：人物横向移动方向与下一镜机位横移方向一致',
      '光影变化接：沿本场 ⑦ 光源 的既有光位与色温承接，下一镜在同一明暗关系下起幅',
      '焦点转移接：焦点从前景人物转移到后景物体，下一镜以该物体为前景',
    ]);
    expect(Object.keys(transitionTemplates)).toHaveLength(11);
    expect(new Set(Object.values(transitionTemplates)).size).toBe(11);
    expect(transitionPositivePool).toHaveLength(11);
  });

  it('段末两口径（换场 / 收束）文案未被改写', () => {
    expect(segmentTailTransition.sceneChange).toBe('换场衔接：本段收束后进入下一场次，轴线按新场次重设，光位与空间底噪随场次切换');
    expect(segmentTailTransition.closing).toBe('本集收束：以本镜落幅收住全集，保持本场轴线与光位不变，不留悬空动势');
  });

  it('14 格骨架：key 顺序与 label 逐字与抽包前一致', () => {
    expect(skeletonFields.map((item) => item.key)).toEqual([
      'character', 'scene', 'scale', 'composition', 'lens', 'movement', 'light', 'atmosphere',
      'blocking', 'action', 'performance', 'dialogue', 'sound', 'transition',
    ]);
    expect(skeletonFields.map((item) => item.label)).toEqual([
      '人物参考图的描述', '场景参考图的描述', '景别', '构图', '焦距', '运镜', '光源', '氛围',
      '人物站位 + 朝向', '肢体动作（方位/动线）', '微表情', '台词 / 内心OS', '音效', '衔接',
    ]);
    expect(skeletonFields).toHaveLength(14);
  });

  it('生成通道 11 键与禁改 3 键：逐词一致，且两者无交集', () => {
    expect([...skeletonGeneratedKeys]).toEqual([
      'scale', 'composition', 'lens', 'movement', 'light', 'atmosphere', 'blocking', 'action', 'performance', 'sound', 'transition',
    ]);
    expect([...skeletonProtectedKeys]).toEqual(['character', 'scene', 'dialogue']);
    expect([...h3CompileAllowedKeys]).toEqual([...skeletonGeneratedKeys]);
    expect(skeletonGeneratedKeys.filter((key) => (skeletonProtectedKeys as readonly string[]).includes(key))).toEqual([]);
    expect(skeletonGeneratedKeys.length + skeletonProtectedKeys.length).toBe(14);
  });

  it('闸门分级表 40 条：逐条 severity 与 category 与抽包前一致', () => {
    expect(issuePolicy).toEqual({
      EMPTY: { severity: 'error', category: 'input' },
      DURATION: { severity: 'error', category: 'input' },
      SEGMENT_NUMBER: { severity: 'error', category: 'input' },
      SHOT_NUMBER: { severity: 'error', category: 'input' },
      SHOT_DURATION: { severity: 'error', category: 'input' },
      SHOT_DURATION_MAX: { severity: 'error', category: 'input' },
      FIELD_REQUIRED: { severity: 'error', category: 'input' },
      PURPOSE_REQUIRED: { severity: 'error', category: 'input' },
      CHARACTER_ANCHOR: { severity: 'warning', category: 'review' },
      TRANSITION: { severity: 'error', category: 'input' },
      DIALOGUE_LIMIT: { severity: 'error', category: 'input' },
      IMAGE_LIMIT: { severity: 'error', category: 'input' },
      SCENE_REFERENCE: { severity: 'error', category: 'input' },
      SHOT_SOURCE: { severity: 'error', category: 'input' },
      VISUAL_UNCONFIRMED: { severity: 'warning', category: 'reference' },
      IMAGE_UNDESCRIBED: { severity: 'warning', category: 'reference' },
      SOURCE_VERSION: { severity: 'error', category: 'source' },
      SOURCE_STRUCTURE: { severity: 'error', category: 'source' },
      DIALOGUE_PROTECTION: { severity: 'error', category: 'source' },
      BEAT_COVERAGE: { severity: 'error', category: 'source' },
      CHARACTER_ANCHOR_DRIFT: { severity: 'error', category: 'source' },
      IMAGE_PLACEHOLDER: { severity: 'error', category: 'safety' },
      TRANSITION_FORBIDDEN: { severity: 'error', category: 'safety' },
      DIRECTOR_UNCONFIRMED: { severity: 'warning', category: 'review' },
      DIALOGUE_LOAD: { severity: 'warning', category: 'review' },
      SHOT_DENSITY: { severity: 'warning', category: 'review' },
      ACTION_REVIEW: { severity: 'warning', category: 'review' },
      CONTINUITY_REVIEW: { severity: 'warning', category: 'review' },
      CHARACTER_CONTINUITY: { severity: 'warning', category: 'review' },
      BLOCKING_CONTINUITY: { severity: 'warning', category: 'review' },
      COMPOSITION_CONTINUITY: { severity: 'warning', category: 'review' },
      LIGHT_CONTINUITY: { severity: 'warning', category: 'review' },
      AUTO_MATCH_LOW_CONFIDENCE: { severity: 'warning', category: 'review' },
      EPISODE_SPLIT_UNVERIFIED: { severity: 'warning', category: 'review' },
      AXIS_JUMP: { severity: 'error', category: 'source' },
      TRANSITION_PREMISE: { severity: 'error', category: 'source' },
      SPEAKER_UNTRUSTED: { severity: 'error', category: 'source' },
      BLOCKING_UNKNOWN_SUBJECT: { severity: 'warning', category: 'review' },
      SCALE_SUBJECT_CONFLICT: { severity: 'warning', category: 'review' },
      STAGING_COMPOSITION_CONFLICT: { severity: 'warning', category: 'review' },
    });
    expect(Object.keys(issuePolicy)).toHaveLength(40);
  });

  it('问题分类名与可忽略分类未被改写', () => {
    expect(issueCategoryNames).toEqual({
      input: '输入不完整', reference: '原图描述缺失', source: '剧本结构/台词不一致', safety: '内容安全', review: '建议复核',
    });
    expect([...ignorableIssueCategories]).toEqual(['input', 'reference']);
  });

  it('facts 类才阻断：所有 error 的 category 必属 input / reference / source / safety', () => {
    const allowed = new Set(['input', 'reference', 'source', 'safety']);
    for (const [code, policy] of Object.entries(issuePolicy)) {
      if (policy.severity === 'error') expect(allowed.has(policy.category), `${code} 的 error 分类不属事实类 / 内容安全`).toBe(true);
    }
  });
});

describe('P1 单源校验：各模块导出与默认包是同一引用，不是副本', () => {
  it('rules.ts 的再导出指向默认包本体（禁词表 / 闸门表）', () => {
    expect(rulesForbiddenWords).toBe(transitionForbiddenWords);
    expect(rulesIssuePolicy).toBe(issuePolicy);
  });

  it('skeleton.ts 的再导出指向默认包本体（14 格 / 11 键 / 3 键）', () => {
    expect(fields).toBe(skeletonFields);
    expect(generatedKeys).toBe(skeletonGeneratedKeys);
    expect(protectedKeys).toBe(skeletonProtectedKeys);
  });

  it('director 的 ⑭ 成稿池取自默认包文案（逐条同引用，非同值副本无从谈起）', () => {
    expect(transitionPool).toEqual(Object.values(transitionTemplates));
  });
});
