import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../src/core/planner';
import { segmentDuration, shotDurationMax, shotDurationMin } from '../../src/core/timing';
import { activeEpisode, type Project, type ReferenceImage } from '../../src/core/model';
import type { ShotDraft } from '../../src/platforms/minimax-h3/director';
import { sourceFieldsForShot } from '../../src/platforms/minimax-h3/director';
import { compositionContradictsStaging } from '../../src/platforms/minimax-h3/director';

const script = `# 第一场 室内
甲：你看见那封信了吗？
乙：我没有打开。
甲走向桌边。`;

/** 存档层替身：记录载入与落盘次数，并保留每次落盘的内容用于断言合并结果。 */
const harness = vi.hoisted(() => ({
  loads: 0,
  saves: 0,
  snapshots: [] as string[],
  draft: null as unknown,
}));

vi.mock('../../src/core/storage', () => ({
  loadDraft: async () => {
    harness.loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { project: harness.draft, migrated: false, storage: 'indexeddb' as const, droppedProps: 0 };
  },
  saveDraft: async (project: unknown) => {
    harness.saves += 1;
    harness.snapshots.push(JSON.stringify(project));
    return 'indexeddb' as const;
  },
  clearDraft: async () => {},
  legacyStorageKey: 'script-storyboard-workbench-draft-v1',
  autosaveStateKey: 'script-storyboard-workbench-autosave',
}));

/** store 持有模块级状态，逐用例重置模块以获得干净的存档闸门。 */
async function freshStore() {
  vi.resetModules();
  return import('../../src/store');
}

beforeEach(() => {
  harness.loads = 0; harness.saves = 0; harness.snapshots = []; harness.draft = null;
});

describe('启动恢复：hydrate 不允许重复执行', () => {
  it('runs the load exactly once under concurrent and repeated calls', async () => {
    const { useWorkbench } = await freshStore();
    await Promise.all([useWorkbench.getState().hydrate(), useWorkbench.getState().hydrate()]);
    await useWorkbench.getState().hydrate();
    expect(harness.loads).toBe(1);
    expect(useWorkbench.getState().storageReady).toBe(true);
  });

  it('never reloads the snapshot after later state changes', async () => {
    const { useWorkbench } = await freshStore();
    await useWorkbench.getState().hydrate();
    useWorkbench.getState().setProject(createProject(script));
    useWorkbench.getState().setMode('action');
    await useWorkbench.getState().hydrate();
    expect(harness.loads).toBe(1);
  });

  it('restores the saved project and focuses its first segment', async () => {
    harness.draft = createProject(script);
    const { useWorkbench } = await freshStore();
    await useWorkbench.getState().hydrate();
    const project = useWorkbench.getState().project as Project;
    expect(project.episodes).toHaveLength(1);
    expect(useWorkbench.getState().selectedSegment).toBe(activeEpisode(project).segments[0].id);
  });
});

describe('存档写入：合并窗口与立即落盘', () => {
  it('collapses a burst of edits into one write of the latest snapshot', async () => {
    vi.useFakeTimers();
    try {
      const { useWorkbench, autosaveDelay } = await freshStore();
      useWorkbench.getState().setProject(createProject(script));
      useWorkbench.getState().setMode('action');
      useWorkbench.getState().setMode('dialogue');
      expect(harness.saves).toBe(0);
      await vi.advanceTimersByTimeAsync(autosaveDelay + 10);
      expect(harness.saves).toBe(1);
      expect(JSON.parse(harness.snapshots.at(-1) as string).defaultMode).toBe('dialogue');
    } finally { vi.useRealTimers(); }
  });

  it('flushes the pending snapshot on demand', async () => {
    const { useWorkbench, flushPersist } = await freshStore();
    useWorkbench.getState().setProject(createProject(script));
    expect(harness.saves).toBe(0);
    await flushPersist();
    expect(harness.saves).toBe(1);
  });
});

describe('生成回填：只给真正写入字段的镜头打来源标记', () => {
  it('does not tag a shot that received no field', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(script));
    const segment = activeEpisode(useWorkbench.getState().project as Project).segments[0];
    const [first, second] = segment.shots;
    const drafts: ShotDraft[] = [
      { shotId: first.id, fields: { scale: '中景' }, source: 'local' },
      { shotId: second.id, fields: {}, source: 'local' },
    ];
    const filled = useWorkbench.getState().applyGenerated(segment.id, drafts, { overwrite: false, source: 'local' });
    expect(filled).toBe(1);
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0];
    expect(updated.shots[0].draftSource).toBe('local');
    expect(updated.shots.filter((shot) => shot.draftSource)).toHaveLength(1);
    expect(updated.directorGenerated).toBe(true);
  });

  it('被生成动作扫过、但没有一条字段写入的段不得挂「已生成」', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(script));
    const before = useWorkbench.getState().project as Project;
    const segment = activeEpisode(before).segments[0];
    /**
     * 复现老大 2026-10-06 截图那一幕：AI 依次推理是**一段一段**的，没轮到的那一段板上本该是空白。
     * 旧口径（`const marked = true`）把「这一批扫过本段」等同于「本段已生成」——
     * 于是整集导出（`prepareForExport` 对每段跑一遍生成）之后，整集每段都挂标。
     * 现在段级标记由镜头来源标记派生：一镜都没真写入 ⇒ 不挂标，且**整份快照引用不变**（幂等空转）。
     */
    const filled = useWorkbench.getState().applyGenerated(segment.id, [
      { shotId: segment.shots[0].id, fields: {}, source: 'ai' },
      { shotId: segment.shots[1].id, fields: {}, source: 'ai' },
    ], { overwrite: false, source: 'ai' });
    expect(filled).toBe(0);
    expect(activeEpisode(useWorkbench.getState().project as Project).segments[0].directorGenerated).toBe(false);
    expect(useWorkbench.getState().project).toBe(before);
  });

  it('AI 草稿的 ⑩⑪ 原样落盘（P3：回填层不再替 AI 做证据收敛）', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject('甲：你看见那封信了吗？'));
    const project = useWorkbench.getState().project as Project;
    const segment = activeEpisode(project).segments[0];
    const shot = segment.shots[0];
    useWorkbench.getState().applyGenerated(segment.id, [{
      shotId: shot.id,
      fields: {
        action: '甲抬手指向信封',
        performance: '眉峰轻微上抬',
      },
      source: 'ai',
    }], { overwrite: true, source: 'ai' });
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
    /**
     * 口径（2026-10-06 · P3 §4.2 第 1 项翻转）：旧口径是「⑩⑪⑬ 一律收敛回 `sourceFieldsForShot`」，
     * 用来清掉 P2 之前 AI 的「无依据内容」。P3 起 AI 侧改为「原稿证据优先、无证据按情绪档 ×
     * 弧光位置设计」（prompt 第 7/8/9 条），再在回填层顶替它等于把分治抹平，故此处改为**原样落盘**。
     * 质量兜底改由闸门负责（禁词 / 情绪形容词 / 人名），回填层不再重复实现一遍。
     */
    expect(updated.action).toBe('甲抬手指向信封');
    expect(updated.performance).toBe('眉峰轻微上抬');
    expect(updated.draftSource).toBe('ai');
  });

  it('本地草稿的 ⑩⑪⑬ 仍逐字等于 sourceFieldsForShot（本地路径行为未变）', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject('甲：你看见那封信了吗？'));
    const project = useWorkbench.getState().project as Project;
    const segment = activeEpisode(project).segments[0];
    const shot = segment.shots[0];
    const canonical = sourceFieldsForShot(project, activeEpisode(project), shot);
    useWorkbench.getState().applyGenerated(segment.id, [{
      shotId: shot.id,
      fields: { action: canonical.action, performance: canonical.performance, sound: canonical.sound },
      source: 'local',
    }], { overwrite: true, source: 'local' });
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
    expect(updated.action).toBe(canonical.action);
    expect(updated.performance).toBe(canonical.performance);
    expect(updated.sound).toBe(canonical.sound);
  });

  it('无来源标记的旧快照仍被校正回原稿证据（校正只剩这一种用途）', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject('甲：你看见那封信了吗？'));
    const project = useWorkbench.getState().project as Project;
    const segment = activeEpisode(project).segments[0];
    const shot = segment.shots[0];
    const canonical = sourceFieldsForShot(project, activeEpisode(project), shot);
    shot.action = '旧缓存乱填动作';
    shot.performance = '旧缓存乱填表情';
    // 刻意不设 `draftSource`：模拟 P1 之前存下的、没有来源标记的旧快照。
    useWorkbench.getState().applyGenerated(segment.id, [{ shotId: shot.id, fields: {}, source: 'local' }], { overwrite: false, source: 'local' });
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
    expect(updated.action).toBe(canonical.action);
    expect(updated.performance).toBe(canonical.performance);
  });

  it('带来源标记的镜头不再被校正（AI 写的值就当 AI 写的，人工改过的不动）', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject('甲：你看见那封信了吗？'));
    const project = useWorkbench.getState().project as Project;
    const segment = activeEpisode(project).segments[0];
    const [first, second] = segment.shots;
    first.action = 'AI 这一镜写的动作';
    first.draftSource = 'ai';
    second.action = '人工改过的动作';
    second.draftSource = 'manual';
    useWorkbench.getState().applyGenerated(segment.id, [
      { shotId: first.id, fields: {}, source: 'local' },
      { shotId: second.id, fields: {}, source: 'local' },
    ], { overwrite: false, source: 'local' });
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots;
    expect(updated[0].action).toBe('AI 这一镜写的动作');
    expect(updated[1].action).toBe('人工改过的动作');
  });

  it('无证据时 AI 的设计落盘，不再被本地情绪档设计顶替', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject('# 第一场\n甲：来了。\n甲走向桌边。\n乙：嗯。\n乙皱眉。'));
    const project = useWorkbench.getState().project as Project;
    const segment = activeEpisode(project).segments[0];
    const shot = segment.shots.find((item) => item.beatIds.some((id) => project.episodes[0].beats.find((beat) => beat.id === id)?.text === '甲走向桌边。')) ?? segment.shots[0];
    useWorkbench.getState().applyGenerated(segment.id, [{
      shotId: shot.id,
      fields: { action: '甲走向桌边', performance: '抬眼看乙，嘴角向下压', sound: '门外脚步声' },
      source: 'ai',
    }], { overwrite: true, source: 'ai' });
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots.find((item) => item.id === shot.id)!;
    // AI 已按 prompt 第 7/8/9 条写：⑩ 抄原稿证据（原文含「走向桌边」）、⑪ 肌群级动作、⑬ 无证据时的底噪。
    expect(updated.action).toContain('甲走向桌边');
    expect(updated.performance).toBe('抬眼看乙，嘴角向下压');
    expect(updated.sound).toBe('门外脚步声');
  });

  /**
   * 2026-10-06 老大报「AI 推理后与本地一键生成一模一样」后的四条回归口径。
   *
   * 直接成因是接口连不上（每段抛错 → 整集回退本地），但**旧回填口径会让它在网络恢复后继续复现**：
   * 板上只要已按本地规则生成过一次（一次本地生成、**任何一次导出**都会经 `prepareForExport` 填满），
   * AI 出稿的每一条字段都会被「仅补空白」逐条跳过 —— AI 一个字都落不了盘。
   */
  describe('AI 出稿的改写边界（不受「覆盖已有内容」开关约束，但不越过人）', () => {
    /** 复现「板上已有本地内容」的前置状态：与先前生成过 / 导出过一次的结果等价。 */
    async function seedLocal(useWorkbench: Awaited<ReturnType<typeof freshStore>>['useWorkbench']) {
      useWorkbench.getState().setProject(createProject(script));
      const project = useWorkbench.getState().project as Project;
      const segment = activeEpisode(project).segments[0];
      const shot = segment.shots[0];
      useWorkbench.getState().applyGenerated(segment.id, [{
        shotId: shot.id, fields: { scale: '中景' }, source: 'local',
      }], { overwrite: false, source: 'local' });
      const seeded = activeEpisode(useWorkbench.getState().project as Project);
      expect(seeded.segments[0].shots[0].scale).toBe('中景');
      expect(seeded.segments[0].shots[0].draftSource).toBe('local');
      return { segmentId: segment.id, shotId: shot.id, episodeId: seeded.id };
    }

    function aiBatch(episodeId: string, segmentId: string, drafts: ShotDraft[]) {
      return [{ episodeId, drafts: [{ segmentId, drafts }] }];
    }

    it('AI 出稿不受「覆盖已有内容」开关拦下：板上已有本地内容时 AI 仍落盘', async () => {
      const { useWorkbench, } = await freshStore();
      const { segmentId, shotId, episodeId } = await seedLocal(useWorkbench);
      const result = useWorkbench.getState().applyGenerationBatch(
        aiBatch(episodeId, segmentId, [{ shotId, fields: { scale: '近景' }, source: 'ai' }]),
        { overwrite: false, source: 'ai' },
      );
      const after = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
      // 旧口径：这里 filled = 0、scale 仍是「中景」、来源仍是本地 —— 也正是老大看到的那一幕。
      expect(result.filled).toBeGreaterThan(0);
      expect(after.scale).toBe('近景');
      expect(after.draftSource).toBe('ai');
    });

    it('AI 不改写人工改过的镜头，并如实回传 protectedShots', async () => {
      const { useWorkbench } = await freshStore();
      const { segmentId, shotId, episodeId } = await seedLocal(useWorkbench);
      useWorkbench.getState().updateShot(shotId, 'scale', '人工定的景别');
      expect(activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0].draftSource).toBe('manual');
      const result = useWorkbench.getState().applyGenerationBatch(
        aiBatch(episodeId, segmentId, [{ shotId, fields: { scale: '近景' }, source: 'ai' }]),
        { overwrite: false, source: 'ai' },
      );
      const after = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
      expect(after.scale).toBe('人工定的景别');
      expect(result.filled).toBe(0);
      // 「0 条字段」必须有个说得出原因的计数，否则界面只能报一句会误导的「校验通过」。
      expect(result.protectedShots).toBe(1);
    });

    it('AI 不改写已锁定的镜头', async () => {
      const { useWorkbench } = await freshStore();
      const { segmentId, shotId, episodeId } = await seedLocal(useWorkbench);
      const locked = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
      locked.locked = true;
      const result = useWorkbench.getState().applyGenerationBatch(
        aiBatch(episodeId, segmentId, [{ shotId, fields: { scale: '近景' }, source: 'ai' }]),
        { overwrite: false, source: 'ai' },
      );
      const after = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
      expect(after.scale).toBe('中景');
      expect(result.protectedShots).toBe(1);
    });

    it('AI 的 ④ 构图不再被本地构图顶替（④⑨ 冲突交给闸门报，不在回填层收敛）', async () => {
      const { useWorkbench } = await freshStore();
      useWorkbench.getState().setProject(createProject(script));
      const project = useWorkbench.getState().project as Project;
      const episode = activeEpisode(project);
      const shot = episode.segments[0].shots[0];
      const localComposition = sourceFieldsForShot(project, episode, shot).composition;
      useWorkbench.getState().applyGenerationBatch(
        aiBatch(episode.id, episode.segments[0].id, [{
          shotId: shot.id,
          fields: { blocking: '甲位于画面左三分之一', composition: '甲位于画面右三分之一' },
          source: 'ai',
        }]),
        { overwrite: false, source: 'ai' },
      );
      const after = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
      /**
       * 前置条件（缺一不可，否则这条用例证明不了任何事）：
       * ① 本地构图与 AI 构图**确实不同** —— 若相同，顶替与不顶替看不出差别；
       * ② ④⑨ **确实互斥**（主体被写到相反一侧）—— 这是旧写法唯一的触发入口。
       *    注意站位文案的规范形态是「位于画面左三分之一」（`sidesIn` 的解析口径），写「左侧」解析不出来。
       */
      expect(localComposition).not.toBe('甲位于画面右三分之一');
      expect(compositionContradictsStaging(after.composition, after.blocking)).toBe(true);
      // 旧口径会把 AI 的构图替换成 `sourceFieldsForShot` 的本地构图（P3 明令禁止的「替 AI 做证据收敛」）。
      expect(after.composition).toBe('甲位于画面右三分之一');
      expect(after.blocking).toBe('甲位于画面左三分之一');
    });
  });
});

describe('批量生成：整本一次写入并标记导演决策已生成', () => {
  const book = '第01集\n# 第一场 书房\n甲：一。\n第02集\n# 第一场 走廊\n乙：二。';

  function batchOf(project: Project) {
    return project.episodes.map((episode) => ({
      episodeId: episode.id,
      drafts: episode.segments.map((segment) => ({
        segmentId: segment.id,
        drafts: [{ shotId: segment.shots[0].id, purpose: '让观众明确台词信息', fields: { scale: '中景' }, source: 'local' as const }],
      })),
    }));
  }

  it('marks every processed segment of every episode in one write', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const project = useWorkbench.getState().project as Project;
    const result = useWorkbench.getState().applyGenerationBatch(batchOf(project), { overwrite: false, source: 'local' });
    expect(result.segments).toBe(project.episodes.length);
    expect(result.filled).toBe(project.episodes.length * 2);
    const after = useWorkbench.getState().project as Project;
    expect(after.episodes.flatMap((episode) => episode.segments).every((segment) => segment.directorGenerated)).toBe(true);
    expect(after.episodes.every((episode) => episode.segments.every((segment) => segment.shots[0].scale === '中景'))).toBe(true);
    expect(harness.saves).toBe(0);
  });

  it('is idempotent: repeating the same batch leaves the snapshot unchanged and marks nothing new', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const first = useWorkbench.getState().applyGenerationBatch(batchOf(useWorkbench.getState().project as Project), { overwrite: false, source: 'local' });
    const once = JSON.stringify(useWorkbench.getState().project);
    const second = useWorkbench.getState().applyGenerationBatch(batchOf(useWorkbench.getState().project as Project), { overwrite: false, source: 'local' });
    /**
     * `segments` 的口径（2026-10-06 起）= **本次由未生成变为已生成的段数**（界面话术直接用它），
     * 不再是「这一批扫过几段」：第一次两段都从空板变为已生成，第二次一段都没有新标记 —— 快照逐字不变。
     */
    expect(first.segments).toBe(2);
    expect(second.segments).toBe(0);
    expect(second.filled).toBe(0);
    expect(JSON.stringify(useWorkbench.getState().project)).toBe(once);
  });

  it('jumps to an episode, segment and shot in one update', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const project = useWorkbench.getState().project as Project;
    const second = project.episodes[1];
    const segment = second.segments[0];
    const shot = segment.shots[1];
    useWorkbench.getState().focusTarget(second.id, segment.id, shot.id);
    const state = useWorkbench.getState();
    expect((state.project as Project).activeEpisodeId).toBe(second.id);
    expect(state.selectedSegment).toBe(segment.id);
    expect(state.selectedShot).toBe(shot.id);
  });
});

describe('局部重建：逐键编辑只改动命中集，非命中集保持引用', () => {
  const book = '第01集\n# 第一场 书房\n甲：一。\n第02集\n# 第一场 走廊\n乙：二。';

  it('updates only the active episode shot; the sibling episode keeps its reference', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const before = useWorkbench.getState().project as Project;
    const sibling = before.episodes[1];
    const target = activeEpisode(before).segments[0].shots[0];
    // 镜头编号每集从 SC01 重新计数：第 2 集同名镜不得被连带修改。
    expect(sibling.segments[0].shots[0].id).toBe(target.id);
    useWorkbench.getState().updateShot(target.id, 'scale', '中景');
    const after = useWorkbench.getState().project as Project;
    expect(activeEpisode(after).segments[0].shots[0].scale).toBe('中景');
    expect(after.episodes[1]).toBe(sibling);
    expect(after.episodes[1].segments[0].shots[0].scale).not.toBe('中景');
  });

  it('leaves a locked shot untouched and produces no new snapshot', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const before = useWorkbench.getState().project as Project;
    const shot = activeEpisode(before).segments[0].shots[0];
    shot.locked = true;
    useWorkbench.getState().updateShot(shot.id, 'scale', '中景');
    expect(useWorkbench.getState().project).toBe(before);
  });

  it('updates the shared asset description without touching unrelated episodes', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const image: ReferenceImage = { id: 'img-1', name: '林夏.png', sha256: 'a'.repeat(64), dataUrl: 'data:image/png;base64,AA==', kind: 'character', description: '旧描述', version: 1 };
    useWorkbench.getState().addImage(image);
    const before = useWorkbench.getState().project as Project;
    const sibling = before.episodes[1];
    useWorkbench.getState().updateImage('img-1', '新描述');
    const after = useWorkbench.getState().project as Project;
    expect(after.assets[0].description).toBe('新描述');
    expect(after.assets[0].version).toBe(2);
    // 资产是项目级单源：没有任何段引用它时，两集的对象引用都不该被牵动。
    expect(after.episodes[1]).toBe(sibling);
  });

  it('删除单张资产：资产库出清，且所有集的绑定与匹配记账一并解除', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const image: ReferenceImage = { id: 'img-1', name: '林夏.png', sha256: 'a'.repeat(64), dataUrl: 'data:image/png;base64,AA==', kind: 'character', description: '甲：白衣', version: 1 };
    useWorkbench.getState().addImages([image]);
    /** 把同一张图绑到两集的首段上，并各记一条匹配结论 —— 删除必须两集都清干净。 */
    const base = useWorkbench.getState().project as Project;
    useWorkbench.getState().setProject({
      ...base,
      episodes: base.episodes.map((episode) => ({
        ...episode,
        imageMatches: { 'img-1': { confidence: 'high' as const, source: 'name' as const } },
        segments: episode.segments.map((segment, index) => (index === 0 ? { ...segment, imageIds: [...segment.imageIds, 'img-1'] } : segment)),
      })),
    });
    useWorkbench.getState().removeImage('img-1');
    const after = useWorkbench.getState().project as Project;
    expect(after.assets).toHaveLength(0);
    for (const episode of after.episodes) {
      expect(episode.segments.every((segment) => !segment.imageIds.includes('img-1'))).toBe(true);
      expect('img-1' in episode.imageMatches).toBe(false);
    }
    // 幂等：再删一次不产生新对象、不报错。
    const again = useWorkbench.getState().project as Project;
    useWorkbench.getState().removeImage('img-1');
    expect(useWorkbench.getState().project).toBe(again);
  });
});

describe('setProject：热路径不再重复全量校验与深拷贝', () => {
  it('直接采用传入的 v2 工程本体，不产生深拷贝', async () => {
    const { useWorkbench } = await freshStore();
    const project = createProject(script);
    useWorkbench.getState().setProject(project);
    expect(useWorkbench.getState().project).toBe(project);
  });

  it('逐键改标题：只换工程引用，字段不丢失且落盘完整', async () => {
    const { useWorkbench, flushPersist } = await freshStore();
    const project = createProject(script);
    let title = '逐键';
    for (const char of '改名不触发全量校验') {
      title += char;
      useWorkbench.getState().setProject({ ...project, title }, false);
    }
    const next = useWorkbench.getState().project as Project;
    expect(next.title).toBe(title);
    expect(next.episodes).toHaveLength(1);
    expect(next.scripts[0].text).toBe(script);
    await flushPersist();
    expect(JSON.parse(harness.snapshots.at(-1) as string).title).toBe(title);
  });

  it('非 v2 入参仍在该入口完成迁移（运行时兜底不丢）', async () => {
    const { useWorkbench } = await freshStore();
    const legacy = {
      schemaVersion: 1, id: 'legacy', title: '旧项目', episode: '第03集',
      contentType: 'short-drama', defaultMode: 'combined', platform: 'minimax-h3',
      compilerVersion: '0.1.0', skeletonVersion: '1.0.0',
      scripts: [{ id: 'script-1', text: script, filename: '旧稿' }], activeScriptId: 'script-1',
      scenes: [{ id: 'scene-1', title: '第一场 室内', range: { start: 0, end: script.length } }],
      beats: [], segments: [], visual: { version: 1, character: '甲', scene: '室内', confirmed: true, source: 'manual' }, images: [],
    };
    useWorkbench.getState().setProject(legacy as unknown as Project);
    const project = useWorkbench.getState().project as Project;
    expect(project.schemaVersion).toBe(2);
    expect(project.episodes).toHaveLength(1);
    expect(project.episodes[0].index).toBe(3);
  });
});

describe('段内时长不变量：每段各镜之和恒为 15 秒', () => {
  /** 断言整本工程满足「段 = 15 秒、各镜求和 = 15、单镜 ∈ [1, 12]」。 */
  function assertDurationInvariant(project: Project) {
    for (const episode of project.episodes) {
      for (const segment of episode.segments) {
        expect(segment.duration).toBe(segmentDuration);
        const total = segment.shots.reduce((sum, shot) => sum + shot.duration, 0);
        expect(total).toBe(segmentDuration);
        for (const shot of segment.shots) {
          expect(shot.duration).toBeGreaterThanOrEqual(shotDurationMin);
          // 单镜独占整段时豁免 12 秒上限——否则段内无法求和为 15。
          if (segment.shots.length > 1) {
            expect(shot.duration).toBeLessThanOrEqual(shotDurationMax);
          }
        }
      }
    }
  }

  it('planning already splits each segment across its shots', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(script));
    assertDurationInvariant(useWorkbench.getState().project as Project);
  });

  it('export preparation must not collapse the allocation back to a fixed per-shot duration', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(script));
    // 回归护栏：prepareForExport 内部走 repair + 自动生成，曾把每镜时长写死回 15，
    // 破坏了「各镜之和 = 段时长」的不变量并阻断导出。
    useWorkbench.getState().prepareForExport();
    assertDurationInvariant(useWorkbench.getState().project as Project);
    const segment = activeEpisode(useWorkbench.getState().project as Project).segments[0];
    expect(segment.shots.some((shot) => shot.duration !== segmentDuration)).toBe(true);
  });
});

describe('来源标记：同一批里 AI 结果与本地兜底混排时逐镜标记', () => {
  const book = '第01集\n# 第一场 书房\n甲：一。\n乙：二。';

  it('tags every shot by its own draft source instead of the batch default', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const project = useWorkbench.getState().project as Project;
    const episode = activeEpisode(project);
    const segment = episode.segments[0];
    const [first, second] = segment.shots;
    // 批次默认 source = 'local'，但第一镜的草稿自带 'ai' —— 应当以草稿自身为准。
    useWorkbench.getState().applyGenerationBatch([{
      episodeId: episode.id,
      drafts: [{ segmentId: segment.id, drafts: [
        { shotId: first.id, fields: { scale: '中景' }, source: 'ai' },
        { shotId: second.id, fields: { scale: '全景' }, source: 'local' },
      ] }],
    }], { overwrite: false, source: 'local' });
    const shots = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots;
    expect(shots[0].draftSource).toBe('ai');
    expect(shots[1].draftSource).toBe('local');
  });
});

describe('人物设定与弧光：按人物落盘（2026-10-06 第二步）', () => {
  it('按名字 upsert，且**不触碰**固定锚点的版本与确认状态', async () => {
    const { useWorkbench } = await freshStore();
    const project = createProject(script);
    // 锚点已确认 —— 这是用户已经付出劳动的状态，填按人物文本绝不该把它打回未确认。
    project.visual = { ...project.visual, character: '甲：白衣', scene: '室内', confirmed: true, version: 3 };
    useWorkbench.getState().setProject(project);

    useWorkbench.getState().updateCastNote('甲', 'setting', '男，30 岁，旧棉袄');
    useWorkbench.getState().updateCastNote('甲', 'arc', '忍让 → 摊牌 → 离开');
    useWorkbench.getState().updateCastNote('乙', 'setting', '女，28 岁');
    // 再写一次已存在的名字：就地改写，不追加第二条。
    useWorkbench.getState().updateCastNote('甲', 'setting', '男，31 岁，旧棉袄');

    const visual = (useWorkbench.getState().project as Project).visual;
    expect(visual.cast).toEqual([
      { name: '甲', setting: '男，31 岁，旧棉袄', arc: '忍让 → 摊牌 → 离开' },
      { name: '乙', setting: '女，28 岁', arc: '' },
    ]);
    expect(visual.version).toBe(3);
    expect(visual.confirmed).toBe(true);
    expect(visual.character).toBe('甲：白衣');
  });
});
