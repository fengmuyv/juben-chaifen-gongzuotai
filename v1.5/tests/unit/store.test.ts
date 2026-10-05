import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../src/core/planner';
import { segmentDuration, shotDurationMax, shotDurationMin } from '../../src/core/timing';
import { activeEpisode, type Project, type ReferenceImage } from '../../src/core/model';
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
    useWorkbench.getState().setProject(createProject('# 第一场\n甲：来了。\n甲走向桌边。\n乙：嗯。\n乙皱眉。'));
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
