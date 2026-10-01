import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../src/core/planner';
import { activeEpisode, type Project } from '../../src/core/model';
import type { ShotDraft } from '../../src/platforms/minimax-h3/director';
import { sourceFieldsForShot } from '../../src/platforms/minimax-h3/director';

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
    return { project: harness.draft, migrated: false, storage: 'indexeddb' as const };
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

  it('rejects invented action and micro-expression fields at the write boundary', async () => {
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
    // 口径（2026-10-01 二次裁定）：⑧⑨ 的写入口径固定为本系统的「原稿证据 + 剧情设计」正本，
    // AI 返回的自由发挥一律不落盘 —— 落盘值必须等于 sourceFieldsForShot 的产出。
    const canonical = sourceFieldsForShot(project, activeEpisode(project), shot);
    expect(updated.action).not.toContain('抬手指向信封');
    expect(updated.performance).not.toContain('眉峰轻微上抬');
    expect(updated.action).toBe(canonical.action);
    expect(updated.performance).toBe(canonical.performance);
  });

  it('repairs stale generated action and micro-expression values without overwrite mode', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject('甲：你看见那封信了吗？'));
    const project = useWorkbench.getState().project as Project;
    const segment = activeEpisode(project).segments[0];
    const shot = segment.shots[0];
    const canonical = sourceFieldsForShot(project, activeEpisode(project), shot);
    shot.action = '旧缓存乱填动作';
    shot.performance = '旧缓存乱填表情';
    shot.draftSource = 'ai';
    useWorkbench.getState().applyGenerated(segment.id, [{ shotId: shot.id, fields: {}, source: 'local' }], { overwrite: false, source: 'local' });
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots[0];
    expect(updated.action).toBe(canonical.action);
    expect(updated.performance).toBe(canonical.performance);
  });

  it('keeps exact source action evidence and designs the performance from the drama', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject('# 第一场\n甲走向桌边。\n乙皱眉。'));
    const project = useWorkbench.getState().project as Project;
    const segment = activeEpisode(project).segments[0];
    const shot = segment.shots.find((item) => item.beatIds.some((id) => project.episodes[0].beats.find((beat) => beat.id === id)?.text === '甲走向桌边。')) ?? segment.shots[0];
    useWorkbench.getState().applyGenerated(segment.id, [{
      shotId: shot.id,
      fields: { action: '凭空补的动作', performance: '凭空补的表情', sound: '凭空补的音效' },
      source: 'ai',
    }], { overwrite: true, source: 'ai' });
    const updated = activeEpisode(useWorkbench.getState().project as Project).segments[0].shots.find((item) => item.id === shot.id)!;
    // 原稿有动作证据 → 逐字保留；⑨ 无原稿证据 → 按剧情语义设计（不是 AI 编造，也不是「无」）；
    // ⑬ 无声音证据且场景（「第一场」）无环境线索 → 「无」。
    expect(updated.action).toBe('甲走向桌边（沿目标方向横向移动，间距逐步缩短）');
    expect(updated.performance).not.toBe('凭空补的表情');
    expect(updated.performance).toMatch(/甲/);
    expect(updated.sound).toBe('无');
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

  it('is idempotent: repeating the same batch leaves the snapshot unchanged', async () => {
    const { useWorkbench } = await freshStore();
    useWorkbench.getState().setProject(createProject(book));
    const first = useWorkbench.getState().applyGenerationBatch(batchOf(useWorkbench.getState().project as Project), { overwrite: false, source: 'local' });
    const once = JSON.stringify(useWorkbench.getState().project);
    const second = useWorkbench.getState().applyGenerationBatch(batchOf(useWorkbench.getState().project as Project), { overwrite: false, source: 'local' });
    expect(first.segments).toBe(second.segments);
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
