import { create } from 'zustand';
import { activeEpisode, isSegmentGenerated, type DefaultMode, type DraftSource, type Episode, type ImageAnalysis, type ImageMatch, type MatchConfidence, type MatchSource, type Project, type ReferenceImage, type Shot } from './core/model';
import { migrateProject } from './core/migrate';
import { createProject, rebuildEpisodes, reconcileSplit } from './core/planner';
import { clearDraft, loadDraft, saveDraft } from './core/storage';
import type { EditableShotKey } from './platforms/minimax-h3/skeleton';
import { compositionContradictsStaging, sourceFieldsForShot, type ShotDraft } from './platforms/minimax-h3/director';
import { repairProject } from './platforms/minimax-h3/repair';
import { generateEpisodeDrafts } from './platforms/minimax-h3/director';

export type MatchAssignment = { imageId: string; segmentIds: string[]; confidence: MatchConfidence; source: MatchSource; reason: string };
export type { ShotDraft };

/** 生成批次：一集一组，携带该集的匹配结果与逐段草稿；整批一次写入，避免整本逐集逐段落盘。 */
export type GenerationBatchEntry = {
  episodeId: string;
  assignments?: MatchAssignment[];
  drafts?: { segmentId: string; drafts: ShotDraft[] }[];
};
export type GenerationOptions = { overwrite: boolean; source: DraftSource; replaceMatches?: boolean };
export type GenerationResult = {
  filled: number;
  /** 本次由「未生成」变为「已生成」的段数（派生自镜头来源标记）。 */
  segments: number;
  /**
   * 本次**想写却被人的劳动成果挡住**的镜头数（2026-10-06 新增）。
   *
   * 用途只有一个：AI 出稿但一条字段都没落盘时，界面要能说清「为什么没写」——
   * 这本来只能报一句会误导的「校验通过」，老大看不出到底是没跑、跑失败、还是被边界挡住。
   */
  protectedShots: number;
};
export type PrepareExportResult = { repairedEpisodes: string[]; generatedFields: number; unresolved: string[] };

type State = {
  project: Project | null; selectedSegment: string | null; selectedShot: string | null;
  autosaveError: boolean; storageReady: boolean; migrated: boolean; storage: 'indexeddb' | 'localstorage' | 'none'; storageError: boolean;
  /**
   * 本次载入因「道具」图类退役被**丢弃**的资产张数（0 = 无）。
   * 界面据此显示提示条：按裁定可以丢，但必须**说得出丢了什么**。
   */
  droppedProps: number;
  /**
   * 打开存档时的**解析口径对账**结果（见 `planner.reconcileSplit`）：
   * `rebuilt` = 旧口径且无用户内容，已自动重建分集；`stale` = 旧口径但有用户内容，仅提示、不动数据。
   * 界面据此显示提示条 —— 对账绝不静默。
   */
  splitStatus: 'current' | 'rebuilt' | 'stale';
  hydrate(): Promise<void>;
  clearWorkspace(): Promise<void>;
  setProject(project: Project, focus?: boolean): void;
  repair(episodeId?: string): { repairedEpisodes: string[]; unresolved: string[] };
  prepareForExport(episodeId?: string): PrepareExportResult;
  importScript(text: string, filename: string): void;
  updateScript(text: string): void; replan(): void; setMode(mode: DefaultMode): void;
  selectEpisode(id: string): void; verifySplit(): void;
  /** 原子跳转：切集并选中指定段与镜，供阻断清单与问题面板定位使用。 */
  focusTarget(episodeId: string, segmentId?: string | null, shotId?: string | null): void;
  setSegmentMode(id: string, mode: 'dialogue' | 'action'): void; selectSegment(id: string): void; selectShot(id: string): void;
  updateVisual(key: 'character' | 'scene', value: string): void; confirmVisual(): void;
  /**
   * 按人物的「人物设定 / 人物弧光」（`visual.cast`）。**只落盘**，本轮不接进生成链路。
   * 名字不在数组里就追加到末尾（顺序 = 首次填写顺序），在就就地改写。
   */
  updateCastNote(name: string, key: 'setting' | 'arc', value: string): void;
  addImage(image: ReferenceImage): void; addImages(images: ReferenceImage[]): { added: number; duplicates: number };
  /** 写入描述（**填了即生效**，无需再确认）；`analysis` 只在补齐时一并落库（导入阶段不做任何计算，故资产默认无分析快照）。 */
  updateImage(id: string, description: string, analysis?: ImageAnalysis): void;
  /** 删除单张资产：同时解除它在**所有集、所有段**上的绑定与匹配记账（资产库是单源，删就必须删干净）。 */
  removeImage(id: string): void;
  toggleImage(segmentId: string, imageId: string): boolean;
  applyMatch(assignments: MatchAssignment[], options?: { replace?: boolean }, episodeId?: string): void;
  /** 生成通道的唯一写入口：匹配回填 + 逐段回填 + 标记「导演决策已生成」，整批一次 set/persist。 */
  applyGenerationBatch(entries: GenerationBatchEntry[], options: GenerationOptions): GenerationResult;
  applyGenerated(segmentId: string, drafts: ShotDraft[], options: { overwrite: boolean; source: DraftSource }): number;
  updateShot(id: string, key: EditableShotKey | 'duration' | 'purpose', value: string | number): void;
  confirmSegment(id: string): void;
};

/** 自动存档合并窗口（毫秒）：窗口内的多次改动只落盘最后一次。 */
export const autosaveDelay = 300;

let pendingProject: Project | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

/** 立即把待写入的快照落盘；并发调用按写入队列串行执行，不丢最后一次改动。 */
export function flushPersist(): Promise<void> {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  const snapshot = pendingProject;
  if (!snapshot) return writing;
  pendingProject = null;
  writing = writing
    .then(() => saveDraft(snapshot))
    .then(() => { useWorkbench.setState({ autosaveError: false }); })
    .catch(() => { useWorkbench.setState({ autosaveError: true }); });
  return writing;
}

/**
 * 合并写入：状态变更可能每秒发生几十次（一键生成逐段回填、逐键编辑），
 * 而快照含内嵌参考图可达数 MB，逐次整份写穿 IndexedDB 会拖死主线程。窗口内只保留最后一份。
 */
function persist(project: Project) {
  pendingProject = project;
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => { pendingTimer = null; void flushPersist(); }, autosaveDelay);
}

function withEpisode(project: Project, episodeId: string, mutate: (episode: Episode) => Episode): Project {
  return { ...project, episodes: project.episodes.map((episode) => (episode.id === episodeId ? mutate(episode) : episode)) };
}

function mutateSegmentImages(project: Project, segmentId: string, mutate: (segment: Episode['segments'][number]) => Episode['segments'][number] | null): Project {
  return { ...project, episodes: project.episodes.map((episode) => {
    if (!episode.segments.some((segment) => segment.id === segmentId)) return episode;
    const next = mutate(episode.segments.find((segment) => segment.id === segmentId)!);
    if (!next) return episode;
    return { ...episode, segments: episode.segments.map((segment) => (segment.id === segmentId ? next : segment)) };
  }) };
}

/**
 * 按镜定位所属集：**当前激活集优先**（镜头编号跨集重复，按 id 全局匹配会误改同名镜），
 * 命中后只重建「该集 · 该段」，其余集与其余段保持原对象引用 —— 避免每次按键做全书规模的浅拷贝。
 */
function mutateShot(project: Project, shotId: string, mutate: (shot: Shot) => Shot | null): Project {
  const episode = activeEpisode(project);
  const index = episode.segments.findIndex((segment) => segment.shots.some((shot) => shot.id === shotId));
  if (index < 0) return project;
  const segment = episode.segments[index];
  let changed = false;
  const shots = segment.shots.map((shot) => {
    if (shot.id !== shotId) return shot;
    const next = mutate(shot);
    if (!next) return shot;
    changed = true;
    return next;
  });
  if (!changed) return project;
  const segments = episode.segments.slice();
  segments[index] = { ...segment, confirmed: false, shots };
  return withEpisode(project, episode.id, (item) => ({ ...item, segments }));
}

function focus(project: Project) {
  const episode = activeEpisode(project);
  return { selectedSegment: episode.segments[0]?.id ?? null, selectedShot: episode.segments[0]?.shots[0]?.id ?? null };
}

/**
 * 匹配结果回填：资产库本身**不动**（它归全项目所有），只改本集的匹配记账与段落绑定。
 * 资产上的单一 `matchConfidence` 字段正是上一版的病根 —— 同一张图在 A 集是 high、在 B 集是 low 时它必然说谎。
 * 只更新真正发生变化的集与段，未变化的对象保持引用不变。
 */
function mergeMatches(episode: Episode, assignments: MatchAssignment[], replace: boolean): Episode {
  const selected = new Set(assignments.map((item) => item.imageId));
  let changed = false;
  const imageMatches: Record<string, ImageMatch> = { ...episode.imageMatches };
  for (const assignment of assignments) {
    const current = imageMatches[assignment.imageId];
    if (current && current.confidence === assignment.confidence && current.source === assignment.source) continue;
    imageMatches[assignment.imageId] = { confidence: assignment.confidence, source: assignment.source };
    changed = true;
  }
  const segments = episode.segments.map((segment) => {
    const base = replace ? segment.imageIds.filter((id) => !selected.has(id)) : [...segment.imageIds];
    const incoming = assignments.filter((entry) => entry.segmentIds.includes(segment.id)).map((entry) => entry.imageId);
    const merged = [...base];
    for (const id of incoming) {
      if (merged.includes(id)) continue;
      if (merged.length >= 6) continue;
      merged.push(id);
    }
    if (merged.join('|') === segment.imageIds.join('|')) return segment;
    changed = true;
    return { ...segment, imageIds: merged, confirmed: false };
  });
  return changed ? { ...episode, imageMatches, segments } : episode;
}

/**
 * 生成结果回填：只给真正写入字段的镜头打来源标记；段级「导演决策已生成」由**镜头来源标记派生**
 * （`isSegmentGenerated`）——本段一镜都没真写入，就不会挂标（见函数内 `marked` 处的理由）。
 * 无写入时不产生新对象，重复执行同一批生成不会改动快照（幂等）。
 *
 * **P3 · 双引擎分治下的回填口径**：本函数不再替 AI 做「证据收敛」——⑩⑪⑬ 以草稿自带的值为准
 * （本地草稿的值本就来自 `sourceFieldsForShot`，故本地路径与旧写法逐字等价）。
 * 逐条分流规则与理由见函数内注释；这是「本地引擎与 AI 引擎各自出稿、回填层只忠实落盘」的落点。
 */
function mergeDrafts(project: Project, episode: Episode, entry: { segmentId: string; drafts: ShotDraft[] }[], options: GenerationOptions, counter: GenerationResult): Episode {
  const bySegment = new Map(entry.map((item) => [item.segmentId, item.drafts]));
  let changed = false;
  const segments = episode.segments.map((segment) => {
    const drafts = bySegment.get(segment.id);
    if (!drafts) return segment;
    let filled = 0;
    const shots = segment.shots.map((shot) => {
      const draft = drafts.find((item) => item.shotId === shot.id);
      if (!draft) return shot;
      const next: Shot = { ...shot };
      const sourceFields = sourceFieldsForShot(project, episode, shot);
      let shotFilled = 0;
      /**
       * **改写边界**（2026-10-06 修订 · 老大报「AI 推理后与本地一键生成一模一样」后定）。
       *
       * 两种草稿来源的语义必须分开看：
       * - `draft.source === 'local'`（本地规则保底）：沿用旧语义 —— 未勾「覆盖已有内容」时**只补空白**，
       *   与界面文案「仅补空白，不覆盖已有内容 / 已按要求覆盖」一致；
       * - `draft.source === 'ai'`（AI 主路径）：**不受顶栏开关约束**。点了「AI 依次推理」就是要看到
       *   AI 那一版稿 —— 旧口径下只要板上已按本地规则生成过一次（一次本地生成、**任何一次导出**都会
       *   走 `prepareForExport` 把它填满），AI 的每一条字段都会在下面被 `continue` 跳过，
       *   于是「AI 出来的一模一样」既是观感也是事实：AI 一个字都没落盘。
       *
       * 唯一不能越过的线是**人**：`locked`（已锁定）与 `draftSource === 'manual'`（人工改过）的镜头，
       * 生成通道一律不得改写 —— 这是人的劳动成果，且与「未勾选覆盖」时的克制一致。
       */
      const aiTakeover = draft.source === 'ai' && !next.locked && next.draftSource !== 'manual';
      /** 本镜是否有字段「AI 想写、但被人的成果挡住」——专供提示条说清「为什么 0 条」。 */
      let blockedByHuman = false;
      /**
       * 历史遗留校正（**P3 收窄到「空 tier」**）。
       *
       * 原委：P2 之前 AI 只能照抄原稿证据，回填层于是把 ⑩⑪⑬ **无条件**收敛为 `sourceFieldsForShot` 的
       * 产出（即使未开启覆盖），用来清掉「无依据内容」。P3 双引擎分治后这条前提消失了 ——
       * AI 侧已改为「原稿证据优先、无证据按情绪档 × 弧光位置设计」（prompt 第 7/8/9 条），
       * 再拿本地证据顶替它，等于把分治的意义抹平（这正是旧版「AI 只能照抄」的成因）。
       *
       * 于是按条目 tier 分流：**只有没有来源标记的镜头**（P1 之前存下的旧快照，可能含无依据内容）
       * 仍做一次校正；`local` / `ai` / `manual` 三种 tier 一律不再校正 ——
       * 「本地生成」的草稿值本来就等于 `sourceFieldsForShot`（同源），无需收敛；
       * 「AI 生成」的按新口径采纳；「人工改过」与 `locked` 是人的劳动成果，生成通道不得改写。
       */
      if (!next.locked && !next.draftSource) {
        for (const key of ['action', 'performance', 'sound'] as const) {
          if (next[key].trim() && next[key].trim() !== sourceFields[key]) {
            next[key] = sourceFields[key];
            shotFilled += 1;
          }
        }
      }
      if (draft.purpose?.trim() && (options.overwrite || !next.purpose.trim())) {
        next.purpose = draft.purpose.trim();
        shotFilled += 1;
      }
      // 时长以草稿携带的分配结果为准（`core/timing` 是唯一权威），不得就地写死。
      if (draft.duration !== undefined && next.duration !== draft.duration) { next.duration = draft.duration; shotFilled += 1; }
      for (const [key, rawValue] of Object.entries(draft.fields) as [EditableShotKey, string][]) {
        /**
         * P3 · 四态分流（§4.2 第 1 项）：证据型字段（⑩⑪⑬）**不再无条件收敛为本地证据**。
         *
         * - `draft.source === 'local'`：草稿值本来就取自 `sourceFieldsForShot`（本地正本），
         *   直接用草稿值与旧写法**逐字等价** —— 本地路径行为零变化；
         * - `draft.source === 'ai'`：采纳 AI 的设计（新 prompt 要求原稿证据优先、无证据时按情绪档 ×
         *   弧光位置设计），不再被本地证据顶替 —— 这就是本轮要改的那一条；
         * - 人工 tier 与 `locked` 由 `overwrite` 开关决定（未开即不写已有值），与界面文案
         *   「仅补空白，不覆盖已有内容 / 已按要求覆盖」一致。
         *
         * 闸门仍独立兜底：⑩⑪⑬ 的转场禁词、⑪ 禁情绪形容词、⑫/⑨ 人名等由 `audit` 与 `validate` 校验，
         * 回填层不重复实现一遍（否则又是一个双写漂移点）。
         */
        const value = rawValue;
        if (!value || !value.trim()) continue;
        const current = String(next[key] ?? '');
        if (current.trim() && !options.overwrite && !aiTakeover) {
          // AI 想写却被人的成果挡住（`manual` / `locked`）：计入 `protectedShots`，
          // 让提示条说得出原因，而不是只报一句会误导的「校验通过」。
          if (draft.source === 'ai') blockedByHuman = true;
          continue;
        }
        (next as unknown as Record<string, string>)[key] = value.trim();
        shotFilled += 1;
      }
      /**
       * ④ 构图与 ⑨ 站位必须同源：判定放在逐字段写入**之后** —— 要检查的是**最终落到板上的两个值**，
       * 不是写入前的旧值（旧值可能已被本次草稿替换）。人工改过的镜头不在此列（那是人的决定）；
       * **AI 草稿同样不在此列** —— 它的 ④⑨ 冲突由闸门 `audit` 的 `STAGING_COMPOSITION_CONFLICT`
       * 报出来，回填层若在这里把它替换成本地构图，等于又替 AI 做了一次「证据收敛」（P3 明令禁止）。
       */
      if (!next.locked && next.draftSource !== 'manual' && draft.source !== 'ai' && sourceFields.composition !== next.composition
        && next.composition.trim() && compositionContradictsStaging(next.composition, next.blocking)) {
        next.composition = sourceFields.composition;
        shotFilled += 1;
      }
      if (blockedByHuman) counter.protectedShots += 1;
      if (shotFilled === 0) return shot;
      // 来源以草稿自带者为准：AI 主路径与本地兜底可能在同一批里混排，逐镜标记才准确。
      next.draftSource = draft.source ?? options.source;
      filled += shotFilled;
      return next;
    });
    const shotChanged = shots.some((shot, index) => shot !== segment.shots[index]);
    counter.filled += filled;
    /**
     * 段级标记 = **派生值**（`isSegmentGenerated`：本段至少一镜带 `draftSource`），不再硬编码 `true`。
     *
     * 旧写法把这个布尔**硬编码为真**，把「这一批扫过本段」等同于「本段已生成」：AI 依次推理是逐段来的，
     * 没轮到的段本来该是空白，却照样挂标；`prepareForExport` 更会对整集每一段跑一遍生成 ——
     * 于是「点一次整集导出」就能把整集刷成已生成（老大 2026-10-06 截图）。派生之后，本段没有真写入，
     * 它就自然回到未生成。
     *
     * 顺带把计数改成「本次由未生成变为已生成的段数」：这个数直接进界面话术
     * （「已标记 N 段导演决策已生成」），旧写法无条件 +1，重复生成同一批也会一直报数。
     */
    const marked = isSegmentGenerated({ ...segment, shots });
    if (!shotChanged && segment.directorGenerated === marked) return segment;
    if (marked && !segment.directorGenerated) counter.segments += 1;
    changed = true;
    return { ...segment, confirmed: shotChanged ? false : segment.confirmed, directorGenerated: marked, shots };
  });
  return changed ? { ...episode, segments } : episode;
}

/** 启动恢复只允许真正执行一次：依赖误触发或 StrictMode 双调用都不会再引起自激循环。 */
let hydration: Promise<void> | null = null;
let hydrationEpoch = 0;

export const useWorkbench = create<State>((set, get) => ({
  project: null, selectedSegment: null, selectedShot: null,
  autosaveError: false, storageReady: false, migrated: false, storage: 'none', storageError: false, droppedProps: 0,
  splitStatus: 'current',
  async hydrate() {
    if (get().storageReady) return;
    if (!hydration) {
      const epoch = hydrationEpoch;
      hydration = (async () => {
      try {
        const result = await loadDraft();
        if (epoch === hydrationEpoch && !get().project && result.project) {
          /**
           * 解析口径对账：识别口径升级后，**已存存档里的分集不会自己重算**（用户打开还是旧的坏分集）。
           * 无用户内容 → 自动重建并**立即落盘**（否则用户直接关窗，下次打开又得重算一遍）；
           * 有用户内容 → 只置 `stale` 提示，绝不覆盖。
           */
          const reconciled = reconcileSplit(result.project);
          set({ project: reconciled.project, splitStatus: reconciled.status, ...focus(reconciled.project) });
          if (reconciled.status === 'rebuilt') { persist(reconciled.project); void flushPersist(); }
        }
        set({ storageReady: true, migrated: result.migrated, storage: result.storage, storageError: !!result.failed, droppedProps: result.droppedProps });
      } catch { set({ storageReady: true, storageError: true }); }
      })();
    }
    await hydration;
  },
  async clearWorkspace() {
    hydrationEpoch += 1;
    hydration = Promise.resolve();
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    pendingProject = null;
    await clearDraft();
    set({ project: null, selectedSegment: null, selectedShot: null, migrated: false, autosaveError: false, storageReady: true, storage: 'none', storageError: false, splitStatus: 'current', droppedProps: 0 });
  },
  setProject(project, focusFirst = true) {
    /**
     * 校验只做在「不可信输入」的边界上（storage.loadDraft 读磁盘快照、导入 JSON 前的 projectSchema.parse）。
     * 到这里为止的入参只可能来自两条已校验通道：现造的内存工程（createProject / planProject）或已过 zod 的导入结果。
     * 因此不再重复一次全量校验与深拷贝 —— 这是「作品名称」逐键输入的热路径，
     * 1136KB / 2565 镜的快照实测 migrateProject 约 15ms（其中 zod 约 9~10ms），每键都付一次会被直接感知为卡顿。
     * 运行时兜底：非 v2 入参（类型上不可达）仍走完整迁移。
     */
    const next = project.schemaVersion === 2 ? project : migrateProject(project).project;
    persist(next);
    /** 新导入 / 新造的项目一定带当前口径版本，清掉上一次会话的对账提示。 */
    set({ project: next, splitStatus: 'current', ...(focusFirst ? focus(next) : {}) });
  },
  repair(episodeId) {
    const old = get().project;
    if (!old) return { repairedEpisodes: [], unresolved: ['当前没有项目'] };
    const result = repairProject(old, episodeId);
    if (result.repairedEpisodes.length) {
      persist(result.project);
      set({ project: result.project, ...focus(result.project) });
    }
    return { repairedEpisodes: result.repairedEpisodes, unresolved: result.unresolved };
  },
  prepareForExport(episodeId): PrepareExportResult {
    const old = get().project;
    if (!old) return { repairedEpisodes: [], generatedFields: 0, unresolved: ['当前没有项目'] };
    const repaired = repairProject(old, episodeId);
    if (repaired.repairedEpisodes.length) {
      persist(repaired.project);
      set({ project: repaired.project, ...focus(repaired.project) });
    }
    const current = get().project ?? repaired.project;
    const targets = episodeId ? current.episodes.filter((episode) => episode.id === episodeId) : current.episodes;
    const entries = targets.map((episode) => {
      const drafts = generateEpisodeDrafts(current, episode);
      return { episodeId: episode.id, drafts: [...drafts].map(([segmentId, list]) => ({ segmentId, drafts: list })) };
    });
    const generated = entries.length ? get().applyGenerationBatch(entries, { overwrite: false, source: 'local' }) : { filled: 0, segments: 0, protectedShots: 0 };
    return { repairedEpisodes: repaired.repairedEpisodes, generatedFields: generated.filled, unresolved: repaired.unresolved };
  },
  importScript(text, filename) {
    const project = createProject(text, filename.replace(/\.[^.]+$/, ''));
    project.scripts[0].filename = filename;
    get().setProject(project);
  },
  updateScript(text) {
    const old = get().project; if (!old) return;
    const active = old.scripts.find((item) => item.id === old.activeScriptId) ?? old.scripts[0];
    /**
     * 原稿没变就不新增版本：此前每点一次「保存原稿版本」都往 `scripts` 里再塞**一整本全文**，
     * 存档体积与每次自动保存的 `JSON.stringify` 成本随点击次数线性膨胀（大原稿下是明显卡顿源）。
     */
    if (active.text === text) return;
    /** 文本与某个既有版本完全一致则直接切回去，不制造重复副本。 */
    const existing = old.scripts.find((item) => item.text === text);
    if (existing) { const project = { ...old, activeScriptId: existing.id }; persist(project); set({ project }); return; }
    const version = `script-${old.scripts.length + 1}`;
    const project = { ...old, scripts: [...old.scripts, { id: version, text, filename: '编辑版本' }], activeScriptId: version };
    persist(project); set({ project });
  },
  replan() {
    const old = get().project; if (!old) return;
    /** 与自动对账共用同一个重建函数（`rebuildEpisodes`），避免两套逻辑各自演化。 */
    const project = rebuildEpisodes(old);
    persist(project); set({ project, splitStatus: 'current', ...focus(project) });
  },
  setMode(mode) { const old = get().project; if (!old) return; const project = { ...old, defaultMode: mode }; persist(project); set({ project }); },
  selectEpisode(id) {
    const old = get().project; if (!old || old.activeEpisodeId === id) return;
    const project: Project = { ...old, activeEpisodeId: id };
    persist(project); set({ project, ...focus(project) });
  },
  focusTarget(episodeId, segmentId, shotId) {
    const old = get().project; if (!old) return;
    const episode = old.episodes.find((item) => item.id === episodeId); if (!episode) return;
    const project: Project = old.activeEpisodeId === episodeId ? old : { ...old, activeEpisodeId: episodeId };
    const segment = segmentId ? episode.segments.find((item) => item.id === segmentId) : undefined;
    const selectedSegment = segment?.id ?? episode.segments[0]?.id ?? null;
    const selectedShot = segment && shotId && segment.shots.some((item) => item.id === shotId) ? shotId : segment?.shots[0]?.id ?? null;
    if (project !== old) persist(project);
    set({ project, selectedSegment, selectedShot });
  },
  verifySplit() {
    const old = get().project; if (!old) return;
    const project = withEpisode(old, old.activeEpisodeId, (episode) => ({ ...episode, splitVerified: true }));
    persist(project); set({ project });
  },
  setSegmentMode(id, mode) {
    const old = get().project; if (!old) return;
    const project = { ...old, episodes: old.episodes.map((episode) => ({ ...episode, segments: episode.segments.map((segment) => segment.id === id ? { ...segment, mode, confirmed: false } : segment) })) };
    persist(project); set({ project });
  },
  selectSegment(id) { const episode = get().project ? activeEpisode(get().project!) : null; const segment = episode?.segments.find((item) => item.id === id); set({ selectedSegment: id, selectedShot: segment?.shots[0]?.id ?? null }); },
  selectShot(id) { set({ selectedShot: id }); },
  updateVisual(key, value) {
    const old = get().project; if (!old) return;
    const project = { ...old, visual: { ...old.visual, [key]: value, version: old.visual.version + 1, confirmed: false } };
    persist(project); set({ project });
  },
  confirmVisual() {
    const old = get().project; if (!old || !old.visual.character.trim() || !old.visual.scene.trim()) return;
    const project = { ...old, visual: { ...old.visual, confirmed: true } }; persist(project); set({ project });
  },
  /**
   * 按人物的设定 / 弧光：**不改 `visual.version` 与 `confirmed`**。
   *
   * 那两个字段描述的是**固定锚点**（`visual.character / scene`）的版本与人工确认状态；
   * 按人物的文本是另一码事 —— 若在这里顺手 bump，用户填一个文本框就会把锚点的「已确认」打回未确认，
   * 还会在闸门链路上凭空多出一批状态变化。条目**不清洗**：资产删了名字还在（不静默丢用户劳动），
   * 重新导入同名图即回来；界面只列当前资产里有的名字。
   */
  updateCastNote(name, key, value) {
    const old = get().project; if (!old) return;
    const rewritten = old.visual.cast.map((item) => {
      if (item.name !== name) return item;
      return key === 'setting' ? { ...item, setting: value } : { ...item, arc: value };
    });
    const exists = old.visual.cast.some((item) => item.name === name);
    const cast = exists
      ? rewritten
      : [...rewritten, { name, setting: key === 'setting' ? value : '', arc: key === 'arc' ? value : '' }];
    const project = { ...old, visual: { ...old.visual, cast } };
    persist(project); set({ project });
  },
  addImage(image) {
    const old = get().project; if (!old) return;
    if (old.assets.some((item) => item.sha256 === image.sha256)) return;
    const project = { ...old, assets: [...old.assets, image] };
    persist(project); set({ project });
  },
  addImages(images) {
    const old = get().project; if (!old) return { added: 0, duplicates: 0 };
    /** 去重按**全项目资产库**：同一张图在任何一集导入过，就不必再导第二遍。 */
    const known = new Set(old.assets.map((item) => item.sha256));
    const accepted: ReferenceImage[] = [];
    let duplicates = 0;
    for (const image of images) {
      if (known.has(image.sha256)) { duplicates += 1; continue; }
      known.add(image.sha256); accepted.push(image);
    }
    if (accepted.length) {
      const project = { ...old, assets: [...old.assets, ...accepted] };
      persist(project); set({ project });
    }
    return { added: accepted.length, duplicates };
  },
  updateImage(id, description, analysis) {
    const old = get().project; if (!old) return;
    // 资产是项目级单源：只重建 assets 数组，以及**引用了该资产的段**（其余集与其余段保持原引用）。
    const index = old.assets.findIndex((image) => image.id === id);
    if (index < 0) return;
    const image = old.assets[index];
    const assets = old.assets.slice();
    assets[index] = { ...image, description, ...(analysis ? { analysis } : {}), version: image.version + 1 };
    const episodes = old.episodes.map((episode) => episode.segments.some((segment) => segment.imageIds.includes(id))
      ? { ...episode, segments: episode.segments.map((segment) => segment.imageIds.includes(id) ? { ...segment, confirmed: false } : segment) }
      : episode);
    const project = { ...old, assets, episodes };
    persist(project); set({ project });
  },
  removeImage(id) {
    const old = get().project; if (!old) return;
    if (!old.assets.some((image) => image.id === id)) return;
    const assets = old.assets.filter((image) => image.id !== id);
    const episodes = old.episodes.map((episode) => {
      const bound = episode.segments.some((segment) => segment.imageIds.includes(id));
      if (!bound && !episode.imageMatches[id]) return episode;
      const { [id]: _dropped, ...imageMatches } = episode.imageMatches;
      if (!bound) return { ...episode, imageMatches };
      return {
        ...episode, imageMatches,
        segments: episode.segments.map((segment) => segment.imageIds.includes(id)
          ? { ...segment, imageIds: segment.imageIds.filter((item) => item !== id), confirmed: false }
          : segment),
      };
    });
    const project = { ...old, assets, episodes };
    persist(project); set({ project });
  },
  toggleImage(segmentId, imageId) {
    const old = get().project; if (!old) return false;
    let overflow = false;
    const project = mutateSegmentImages(old, segmentId, (segment) => {
      const imageIds = segment.imageIds.includes(imageId) ? segment.imageIds.filter((id) => id !== imageId) : [...segment.imageIds, imageId];
      if (imageIds.length > 6) { overflow = true; return null; }
      return { ...segment, imageIds, confirmed: false };
    });
    if (overflow) return false;
    persist(project); set({ project });
    return true;
  },
  applyMatch(assignments, options, episodeId) {
    const old = get().project; if (!old) return;
    const episode = episodeId ? old.episodes.find((item) => item.id === episodeId) : activeEpisode(old);
    if (!episode) return;
    get().applyGenerationBatch([{ episodeId: episode.id, assignments }], { overwrite: false, source: 'local', replaceMatches: options?.replace });
  },
  applyGenerationBatch(entries, options) {
    const old = get().project; if (!old) return { filled: 0, segments: 0, protectedShots: 0 };
    const byEpisode = new Map(entries.map((entry) => [entry.episodeId, entry]));
    const counter: GenerationResult = { filled: 0, segments: 0, protectedShots: 0 };
    let changed = false;
    const episodes = old.episodes.map((episode) => {
      const entry = byEpisode.get(episode.id);
      if (!entry) return episode;
      let next = entry.assignments?.length ? mergeMatches(episode, entry.assignments, options.replaceMatches === true) : episode;
      if (entry.drafts?.length) next = mergeDrafts(old, next, entry.drafts, options, counter);
      if (next === episode) return episode;
      changed = true;
      return next;
    });
    if (changed) { const project: Project = { ...old, episodes }; persist(project); set({ project }); }
    return counter;
  },
  applyGenerated(segmentId, drafts, options) {
    const old = get().project; if (!old) return 0;
    const episode = old.episodes.find((item) => item.segments.some((segment) => segment.id === segmentId));
    if (!episode) return 0;
    return get().applyGenerationBatch([{ episodeId: episode.id, drafts: [{ segmentId, drafts }] }], options).filled;
  },
  updateShot(id, key, value) {
    const old = get().project; if (!old) return;
    // 逐键编辑走局部重建：只重建命中集命中段，project 顶层引用仍在变（数据确实变了），
    // 但非命中集保持引用，配合组件级 memo 可把重渲染范围收敛到当前集。
    const project = mutateShot(old, id, (shot): Shot | null => shot.locked ? null : ({
      ...shot, [key]: value, ...(key === 'purpose' || key === 'duration' ? {} : { draftSource: 'manual' as DraftSource }),
    } as Shot));
    if (project === old) return;
    persist(project); set({ project });
  },
  confirmSegment(id) {
    const old = get().project; if (!old) return;
    const project = mutateSegmentImages(old, id, (segment) => ({ ...segment, confirmed: true }));
    persist(project); set({ project });
  },
}));
