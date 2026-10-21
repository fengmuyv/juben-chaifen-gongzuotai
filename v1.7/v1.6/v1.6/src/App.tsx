import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Download, FileInput, FilePlus2, ListChecks, Loader2, PanelRight, Play, Save, Settings, Sparkles, Trash2 } from 'lucide-react';
import { sample } from './fixtures/sample';
import { activeEpisode, activeScript, castNamesOf, episodeSource, projectSchema, type DefaultMode, type Episode, type ImageAnalysis, type Project, type ReferenceImage } from './core/model';
import { samplePixels } from './core/pixels';
import { analyzePixels, analyzeWithStats, neutralPixelStats, type PixelStats } from './core/analyze';
import { buildRoster, matchImages, subjectRoster } from './core/match';
import { splitEpisodes } from './core/episodes';
import { isMarkdownBrief } from './core/planner';
import { requestConnectionTest, requestCredentialsStatus, requestSaveCredentials, requestSegmentFields, type CredentialsStatus, type PreviousShotResult } from './core/vision';
import { type ReasoningLevel } from '../electron/ai-providers';
import { readWord, writeWord } from './core/word';
import { flushPersist, useWorkbench, type GenerationBatchEntry } from './store';
import { generatedKeys, values } from './platforms/minimax-h3/skeleton';
import { ensureSkills } from './platforms/minimax-h3/skills';
import { decodeScriptBytes, normalizeScriptText, sniffScriptPayload } from '../electron/text';
import { foreignNamesIn, generateEpisodeDrafts, projectCast, type ShotDraft } from './platforms/minimax-h3/director';
import { exportBundle } from './platforms/minimax-h3/compiler';
import { validate } from './platforms/minimax-h3/validator';
import { auditProject } from './platforms/minimax-h3/gate';
import { scheduleValidation, type ValidationState } from './core/asyncValidation';
import { allocateShotDurations, segmentDuration } from './core/timing';
import { SourcePane } from './panes/SourcePane';
import { AssetPane } from './panes/AssetPane';
import { DirectorPane } from './panes/DirectorPane';
import { Section } from './panes/Section';
import { CastPane } from './panes/CastPane';
import { SettingsPanel, type SettingsPatch } from './panes/SettingsPanel';
import { GatePanel } from './panes/GatePanel';
import { EpisodePicker } from './panes/EpisodePicker';
import { modeNames, typeNames } from './panes/labels';

const endpointKey = 'script-storyboard-workbench-endpoint';
const modelKey = 'script-storyboard-workbench-model';
const effortKey = 'script-storyboard-workbench-effort';
const aiKey = 'script-storyboard-workbench-ai';
/**
 * 接口默认值来自本机 .env.local（已被 .gitignore 忽略，不进版本库），只含非敏感项：地址与模型名。
 * 优先级：用户手填并存入 localStorage 的值 > 默认值 > 空。
 * **厂商不由用户指名** —— 由主进程按地址自动识别（`providerFromURL`）。
 * **密钥不经过界面** —— 它以无 `VITE_` 前缀的 `WORKBENCH_API_KEY` 存在本机私有配置里，
 * 由主进程读取后直接带在请求头上，界面只显示「是否已配置」。
 */
const defaultEndpoint = import.meta.env.VITE_WORKBENCH_API_ENDPOINT ?? '';
const defaultModel = import.meta.env.VITE_WORKBENCH_API_MODEL ?? '';

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * docx 一律以 base64 在导入链路上传递（IPC 不便直传二进制），
 * 主进程与浏览器两条路径共用同一载荷契约：`kind === 'docx'` 即 content 为 base64。
 */
function toBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

/** 反向还原：base64 → 字节 → Word 读取器。 */
function wordBytes(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

type Progress = { running: boolean; label: string; value: number };

/**
 * 像素统计缓存（key = 资产 sha256）：像素（主色 / 亮度 / 色温 / 光位）**只与图有关**。
 *
 * 资产库提升为项目级后，一次「选集生成」要为每一集各自做一遍图像分析（主体是否命中名册取决于该集），
 * 若每次都重新解码图片，「52 集 × 60 张」会解码 3000 余次 —— 实测单张解码数毫秒，累计就是几十秒的纯浪费。
 * 缓存统计后，逐集只重算「主体 × 名册」这一半，成本与集数无关。
 */
const pixelStatsCache = new Map<string, PixelStats>();

async function pixelStatsOf(image: ReferenceImage): Promise<PixelStats> {
  const cached = pixelStatsCache.get(image.sha256);
  if (cached) return cached;
  try {
    const sampled = await samplePixels(image.dataUrl);
    const stats = analyzePixels(sampled.pixels, sampled.width, sampled.height);
    pixelStatsCache.set(image.sha256, stats);
    return stats;
  } catch { return neutralPixelStats; }
}

/** 生成作业的运行态：idle 未开始 / running 进行中 / paused 暂停在分片边界上。 */
type JobState = 'idle' | 'running' | 'paused';
/** 终止作业的哨兵：只在作业内部流转，不作为错误上报。 */
const jobStopped = Symbol('job-stopped');

/**
 * 让出一帧。整本生成是「逐集逐段」的长循环，同步跑完会把主线程锁死十几秒（实测 52 集 12.8s）。
 * 用 MessageChannel 排一个宏任务边界，让浏览器有机会绘制与响应输入；setTimeout 的 4ms 下限会让分片代价翻倍。
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}

/**
 * 把一次 AI 调用失败压成可读短句，供提示条直接展示（2026-10-06 新增）。
 *
 * 原委：AI 路径的 `catch` 原本是**空捕获**，4 段全失败却只报一句「4 段未通过已回退本地规则结果」，
 * 不写为什么 —— 老大只能看到「AI 与本地一模一样」，无从判断是密钥错了、地址不通，还是返回不合契约。
 * 「失败必须说得出原因」是本条的唯一目的。
 *
 * 剥离 Electron IPC 的包装前缀（`Error invoking remote method 'script:generate': Error:`）——
 * 真正的原因在**末尾**，直接按长度从头截断会把原因切掉。
 */
function errorNote(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw
    .replace(/^Error invoking remote method '[^']*':\s*/u, '')
    .replace(/^Error:\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : (text || '未知原因');
}

/** 同一批失败原因去重后最多并列两条，其余归并为「等 N 类」，避免提示条被长文本撑爆。 */
function failureNoteOf(failures: string[]): string {
  const unique = [...new Set(failures)];
  if (!unique.length) return '';
  const head = unique.slice(0, 2).join('；');
  return `（原因：${head}${unique.length > 2 ? ` 等 ${unique.length} 类` : ''}）`;
}

/** AI 逐段「依次推理」时向前传递的上下文：上一段收尾的 ⑦光源 / ⑨站位 / ⑭衔接，**外加上一段的完整结果**。 */
type PreviousContext = { light: string; blocking: string; transition: string; shots: PreviousShotResult[] };
/** 本集首段的初始上下文：无前序段落时为三空串、无上段结果。 */
const emptyContext: PreviousContext = { light: '', blocking: '', transition: '', shots: [] };
/** AI 就绪参数：地址与模型必填，密钥可留空（由主进程回落本机私有配置）。 */
type AiTarget = { endpoint: string; apiKey: string; model: string; effort: ReasoningLevel };

/** 取某段草稿收尾镜的字段，作为下一段续接的上下文；该字段缺失时沿用上一段的值。 */
function contextAfter(drafts: ShotDraft[], previous: PreviousContext): PreviousContext {
  // 上段完整结果逐镜原样带走（含本地兜底段）—— 下一段要接的是**板上真实状态**，不是 AI 的理想状态。
  const shots: PreviousShotResult[] = drafts.map((draft) => ({
    shotId: draft.shotId,
    fields: Object.fromEntries(Object.entries(draft.fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))),
  }));
  const last = drafts.at(-1);
  if (!last) return { ...previous, shots };
  const read = (key: 'light' | 'blocking' | 'transition', fallback: string) => {
    const value = last.fields[key];
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  };
  return { light: read('light', previous.light), blocking: read('blocking', previous.blocking), transition: read('transition', previous.transition), shots };
}

/**
 * 把**板面**上的某段结果还原成草稿，供 `contextAfter` 使用。
 *
 * 用途只有一个：「重新生成本 P」时的**上一段上下文**。整集生成的上下文链来自刚算出的草稿，
 * 而单段重生只碰一段，上一段的草稿并不在手上 —— 此时正确的上下文是**板上真实结果**
 * （与整集路径「回退段也算上段结果」同一条纪律：下一段要接的是板上状态，不是理想状态）。
 */
function draftsOnBoard(segment: Episode['segments'][number] | undefined): ShotDraft[] {
  if (!segment) return [];
  return segment.shots.map((shot) => ({
    shotId: shot.id, purpose: shot.purpose, duration: shot.duration,
    fields: Object.fromEntries(generatedKeys.filter((key) => !!shot[key]?.trim()).map((key) => [key, shot[key]])) as ShotDraft['fields'],
    source: shot.draftSource ?? 'local',
  }));
}

/**
 * 本集在全片中的**弧光位置**：⑧⑨ 的「设计强度」依据。
 * 本地规则侧由 `designLevelOf`（叙事位置 × 情绪镜密度）算出同一件事，这里把它**显式写给 AI** ——
 * 否则模型只能凭单段文本猜「该收着演还是该放开演」。
 */
function arcNoteOf(project: Project, episode: Episode): string {
  const total = project.episodes.length;
  const index = project.episodes.findIndex((item) => item.id === episode.id);
  if (total <= 1 || index < 0) return '单集作品：无分期弧光，按本场情绪走势设计';
  const ratio = (index + 1) / total;
  const stage = ratio <= 1 / 3 ? '前期（入局·建立）' : ratio <= 2 / 3 ? '中期（纠缠·升级）' : '后期（风暴·决战）';
  return `第 ${index + 1}/${total} 集 · 全片${stage}`;
}

/**
 * AI 单段推理：把该段全部镜头一次性交给文本模型，返回可直接回填的草稿；失败则抛错，由调用方回退本地结果。
 * 约束：只产出 11 条可生成字段，时长由 `core/timing` 分配器决定（AI 不改秒数）。
 * **上下文不截断**（P3 §4.2 第 5/6 项）：随请求带本集原文、人物名册、弧光位置与上段完整结果。
 * **人名防幻觉**（§4.2 第 7 项）：逐镜检查 AI 写出的姓名位，出现名册外的姓名 → **该镜**退回本地结果
 * （不整段退回 —— 段内其余镜仍然可用，逐镜替换的代价远小于丢掉整段的 AI 产出）。
 *
 * @param local 本段本地规则结果，既是逐镜兜底，也是「名册」的判定依据来源。
 */
async function aiSegmentDrafts(
  project: Project, target: Episode, segment: Episode['segments'][number], ai: AiTarget, previous: PreviousContext, local: ShotDraft[],
): Promise<{ drafts: ShotDraft[]; rejected: number }> {
  const images = segment.imageIds
    .map((id) => project.assets.find((image) => image.id === id))
    .filter((image): image is NonNullable<typeof image> => !!image && !!image.description.trim());
  // 本集原文：与校验/重建同一取材口（`episodeSource`）。原稿引用缺失时退空串，不阻断生成。
  let episodeText = '';
  try { episodeText = episodeSource(project, target) ?? ''; } catch { episodeText = ''; }
  const shots = await requestSegmentFields({
    endpoint: ai.endpoint || undefined,
    apiKey: ai.apiKey || undefined,
    effort: ai.effort,
    model: ai.model,
    segment: {
      id: segment.id, mode: segment.mode,
      shots: segment.shots.map((entry) => ({
        id: entry.id, duration: entry.duration,
        beatText: target.beats.filter((beat) => entry.beatIds.includes(beat.id)).map((beat) => beat.text).join(' / '),
        dialogue: entry.dialogue.map((dialogue) => `${dialogue.speaker}：${dialogue.text}`).join('｜'),
      })),
    },
    context: {
      contentType: project.contentType, mode: segment.mode,
      characters: project.visual.character, scene: project.visual.scene,
      imageDescriptions: images.map((image) => image.description.trim()),
      previousBlocking: previous.blocking, previousLight: previous.light, previousTransition: previous.transition,
      script: episodeText, cast: projectCast(project), arc: arcNoteOf(project, target), previousShots: previous.shots,
    },
  });
  const allocated = allocateShotDurations(segment.shots);
  const durationById = new Map(segment.shots.map((shot, index) => [shot.id, allocated[index]]));
  const cast = projectCast(project);
  const localById = new Map(local.map((draft) => [draft.shotId, draft]));
  let rejected = 0;
  const drafts = shots.map((entry) => {
    const fields = Object.fromEntries(generatedKeys.filter((key) => typeof entry.fields[key] === 'string' && entry.fields[key].trim()).map((key) => [key, entry.fields[key]]));
    const fallback = localById.get(entry.shotId);
    /**
     * 人名防幻觉：只扫**主体位字段**（⑨站位 / ⑩肢体动作）—— 这两处主语按定义是人。
     * 刻意不扫 ④构图：构图允许器物作主语（`门框占左前景` / `书桌位于右后景`），扫它会误杀。
     * 命中名册外的姓名 → **整镜**退回本地结果（本地名册口径天然可信）。
     */
    const subjectCues = `${fields.blocking ?? ''}，${fields.action ?? ''}`;
    if (fallback && foreignNamesIn(subjectCues, cast).length) {
      rejected += 1;
      return fallback;
    }
    return {
      shotId: entry.shotId,
      source: 'ai' as const,
      duration: durationById.get(entry.shotId) ?? segmentDuration,
      fields,
    };
  });
  return { drafts, rejected };
}

/**
 * 工作台外壳（P0 拆壳后的编排层）。
 *
 * 本文件只负责：**项目级 state + 事件委托**。视图按下述边界分居 `./panes/`：
 * - `SourcePane` / `AssetPane` —— 左栏两条业务线；`DirectorPane` —— 右栏唯一的汇合产物；
 * - `SettingsPanel` / `GatePanel` / `EpisodePicker` —— 三个浮层；
 * - `labels.ts` —— 界面文案映射单源。
 * 拆壳硬约束是**外观与行为零变化**（class 名、aria-label、DOM 结构、文案逐字不变），
 * 因此这里刻意不顺手改任何交互；界面重排归 P4。
 */
export default function App() {
  /**
   * 细粒度订阅：只订阅真正影响本组件渲染的切片，避免「任意 state 变更 → 整页重渲染」。
   * `store` 取当次渲染的最新快照（函数组件每次渲染都会重新执行），事件处理器里直接调用其方法即可。
   */
  const project = useWorkbench((state) => state.project);
  const selectedSegment = useWorkbench((state) => state.selectedSegment);
  const selectedShot = useWorkbench((state) => state.selectedShot);
  const autosaveError = useWorkbench((state) => state.autosaveError);
  const migrated = useWorkbench((state) => state.migrated);
  /**
   * 「道具」图类退役（2026-10-06）时被丢弃的资产张数。按老大裁定可以直接丢，
   * 但**不许静默丢** —— 这一条提示就是「说得出丢了什么」的落点。
   */
  const droppedProps = useWorkbench((state) => state.droppedProps);
  /**
   * 存档「存在但读不出来」必须与「本来就没有存档」区分：后者是空工作台（正常），
   * 前者若也显示空工作台，用户会以为数据丢了，还可能继续编辑保存、把那份其实还在的原档覆盖掉。
   */
  const storageError = useWorkbench((state) => state.storageError);
  /** 打开存档时的解析口径对账结果：旧口径的分集不会自己重算，必须让用户看见（rebuilt 已自动修 / stale 待用户决定）。 */
  const splitStatus = useWorkbench((state) => state.splitStatus);
  /**
   * 载入完成前**不能**显示「从原剧本开始」的空工作台 —— 那会让用户以为存档丢了。
   * 大项目首次打开要读主存档 + 装回参考图 + 重建分集，这个空窗必须显式占位。
   */
  const storageReady = useWorkbench((state) => state.storageReady);
  const store = useWorkbench.getState();
  /** hydrate 的引用在 store 中始终稳定，可安全作为依赖，不会随每次状态变更重跑。 */
  const hydrate = useWorkbench((state) => state.hydrate);
  /** 载入超过一小段时间才补一句「为什么慢」——小项目一闪而过，不必啰嗦。 */
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (storageReady) return;
    const timer = setTimeout(() => setSlowLoad(true), 1200);
    return () => clearTimeout(timer);
  }, [storageReady]);
  const [message, setMessage] = useState('');
  /** 分集核对清单默认折叠，且折叠态不渲染表格体（避免每次重渲染 diff 数十行）。 */
  const [splitOpen, setSplitOpen] = useState(false);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  /** 界面手填的密钥：**只存内存、不写 localStorage、不进存档**；留空时由主进程用本机私有配置补齐。 */
  const [apiKey, setApiKey] = useState('');
  /**
   * 密钥自动落本机的闸门：只有用户真正动过这个输入框，才允许把当前值写回本机。
   * 少了这道闸门，一打开面板（初始为空）就会把本机已配置的密钥抹掉。
   */
  const [keyTouched, setKeyTouched] = useState(false);
  /** 密钥自动保存的结果说明：只在「本机密钥状态」一行里呈现，不弹提示（避免逐键刷屏）。 */
  const [keyNote, setKeyNote] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [effort, setEffort] = useState<ReasoningLevel>('off');
  /** 接入成功后由该密钥拉回的模型列表，供下拉直接选择。 */
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  /** 本机密钥配置状态：密钥在界面上只以这个布尔量出现，本体永不进入渲染层。 */
  const [localCredentials, setLocalCredentials] = useState<CredentialsStatus | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 「选择集生成」的选集浮层：可只勾一集补跑，也可全选整本重跑，不必为一个按钮背两种语义。 */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedEpisodes, setPickedEpisodes] = useState<string[]>([]);
  const [connection, setConnection] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  /**
   * 片段导出格式（Word / TXT）。刻意放编排层而非 `DirectorPane` 内部 —— 与 `overwrite` 同类：
   * 它决定的是**导出行为**，不是「面板卸载后就该消失的临时输入」。面板在「清空工作台 → 重新导入」
   * 这条路径上会整体卸载重挂，放内部会被静默重置回默认值。
   */
  const [segmentExportFormat, setSegmentExportFormat] = useState<'word' | 'txt'>('word');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [, setAnalyses] = useState<Map<string, ImageAnalysis>>(new Map());
  const [matchNote, setMatchNote] = useState('');
  const [gateOpen, setGateOpen] = useState(false);
  /** 「本次清单会话内已忽略」的条目：**留在编排层**，关清单只卸载视图，重开时记录仍在。 */
  const [ignoredGateIssues, setIgnoredGateIssues] = useState<Set<string>>(new Set());
  /**
   * 资产区自 2026-10-06 起是**两类各一组「下拉 + 已选标签」**（老大原话：「把左边的输入图片改为下拉选择
   * 人物，场景；道具选区不要了」），同日早些时候的三框并列因此被推翻。两类同时可见、各自成框，
   * 但选图这件事只有一个出口（下拉里点一张 → 本段已选）；编排层仍不持「当前看哪一类」这类状态，
   * 面板内部也没有此 state。
   */
  /**
   * 左栏四段的开合（2026-10-06 · P4 定稿）：**全部默认收起**，行右显示摘要。
   * 开关必须留在编排层：分集核对清单的整本解析由 `useMemo` 门在 `splitOpen` 上
   * （`splitEpisodes` 大剧本一次数百毫秒），开关下沉进组件，那个 memo 就失了依据。
   */
  const [openScript, setOpenScript] = useState(false);
  const [openAssets, setOpenAssets] = useState(false);
  const [openCast, setOpenCast] = useState(false);
  /**
   * 原剧本编辑区「已改未存」。左栏折叠即卸载内容，未保存的正文会随卸载丢失 ——
   * 所以把它提到摘要行显式说出来，不让折叠静默吃掉用户的输入。
   */
  const [sourceDirty, setSourceDirty] = useState(false);
  const [issues, setIssues] = useState<ReturnType<typeof validate>>([]);
  const [validationState, setValidationState] = useState<ValidationState>('idle');

  useEffect(() => { void hydrate(); }, [hydrate]);
  /**
   * 启动时装载 skill 包（P2 · 加载器接线；P3 起**供源**）。
   *
   * **不 await、不影响渲染**：加载器只把清单与入口包读进内存，界面不阻塞。P3 起
   * `skills.ts` 的 `useDiskRules` 已翻为 `true` —— 生效判据（⑭ 禁词表）**有包取包、无包回落内置**，
   * 故本步不再只是「暴露包损坏」，而是真的决定了闸门用哪份表；无桥环境（浏览器 `npm run dev`）
   * 内部直接回落内置默认包，不发请求、不报错。
   * 它的结果供 `skillStamp()` 与 P5 的 Skill 管理界面读取。
   */
  useEffect(() => { void ensureSkills(); }, []);
  /** 存档写入有 300ms 合并窗口，离开页面前把待写入快照立即落盘，避免最后几笔改动丢失。 */
  useEffect(() => {
    const flush = () => { void flushPersist(); };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('beforeunload', flush); window.removeEventListener('pagehide', flush); };
  }, []);
  useEffect(() => {
    setEndpoint(localStorage.getItem(endpointKey) || defaultEndpoint);
    setModel(localStorage.getItem(modelKey) || defaultModel);
    setEffort((localStorage.getItem(effortKey) as ReasoningLevel | null) ?? 'off');
    setAiEnabled(localStorage.getItem(aiKey) === '1');
    // 密钥既不在界面也不落盘：只问主进程「本机配好了没有」，拿到的永远是布尔量。
    void requestCredentialsStatus().then(setLocalCredentials);
  }, []);

  const episode = project ? activeEpisode(project) : null;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    if (!project) { setIssues([]); setValidationState('idle'); return () => { cancelled = true; }; }
    setValidationState('validating');
    void scheduleValidation(project, 180, controller.signal).then((next) => {
      if (!cancelled) { setIssues(next); setValidationState('ready'); }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [project]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const segment = episode?.segments.find((item) => item.id === selectedSegment) ?? episode?.segments[0];
  /**
   * 本段**逐镜**的 14 格取值（P4 第二小步 b）：审阅台整 P 铺开，该段所有镜同时可见，
   * 故一次算好整段而不是只算当前镜。必须用 `values(project, shot)` 按**镜头对象引用**定位所属集 ——
   * 镜头编号（SC01）跨集重复，按 id 全局定位会取错集。
   */
  const shotValues = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!project || !segment) return map;
    for (const item of segment.shots) map.set(item.id, values(project, item));
    return map;
  }, [project, segment]);
  const source = project ? activeScript(project) : null;
  const sourceText = source?.text ?? '';
  /**
   * 分集核对清单**只在展开时解析**：`splitEpisodes` 要整本切行 + 逐行正则，
   * 大剧本一次可达数百毫秒；它只服务折叠清单里的标题/字数/行号，折叠态算它是纯浪费。
   * （同 SourcePane 的纪律：折叠态既不渲染 DOM，也不做整本解析。）
   */
  const split = useMemo(() => (splitOpen && sourceText ? splitEpisodes(sourceText) : null), [sourceText, splitOpen]);
  /**
   * 全书阻断清单只在清单打开时计算：整本逐集校验成本高，不能挂在每次编辑上。
   * 清单为浮层，打开期间工作区不可编辑，避免逐键重算。
   */
  const gate = useMemo(() => (project && gateOpen ? auditProject(project) : null), [project, gateOpen]);
  const repairBlocked = (episodeId?: string) => {
    const result = store.repair(episodeId);
    setIgnoredGateIssues(new Set());
    setMessage(result.repairedEpisodes.length ? `已自动修复 ${result.repairedEpisodes.length} 集，正在重新校验${result.unresolved.length ? `；${result.unresolved.join('；')}` : ''}` : `未找到可安全自动修复的内容${result.unresolved.length ? `：${result.unresolved.join('；')}` : ''}`);
  };

  /**
   * 本集的匹配视图：资产库是全项目共用的，因此「本集用了什么、匹配得怎么样」一律以
   * **本集的匹配记账**（`episode.imageMatches`）与段绑定为准，不看别的集。
   */
  const boundIds = useMemo(() => new Set(episode?.segments.flatMap((item) => item.imageIds) ?? []), [episode]);
  const assets = project?.assets ?? [];
  const unassigned = useMemo(() => assets.filter((image) => !!episode?.imageMatches[image.id] && !boundIds.has(image.id)), [assets, episode, boundIds]);
  const lowConfidence = useMemo(() => assets.filter((image) => episode?.imageMatches[image.id]?.confidence === 'low'), [assets, episode]);

  const saveSettings = useCallback((next: SettingsPatch) => {
    if (next.endpoint !== undefined) { setEndpoint(next.endpoint); localStorage.setItem(endpointKey, next.endpoint); }
    // 密钥**刻意不写 localStorage**（浏览器侧明文落盘是上一轮的隐患）：只驻留内存，落盘一律走主进程私有配置。
    if (next.apiKey !== undefined) { setApiKey(next.apiKey); setKeyTouched(true); }
    if (next.model !== undefined) { setModel(next.model); localStorage.setItem(modelKey, next.model); }
    if (next.effort !== undefined) { setEffort(next.effort); localStorage.setItem(effortKey, next.effort); }
    if (next.ai !== undefined) { setAiEnabled(next.ai); localStorage.setItem(aiKey, next.ai ? '1' : '0'); }
  }, []);

  /**
   * 密钥**填一次即常驻本机**：填完自动写私有配置，界面上没有「保存」按钮。
   *
   * 三条边界：
   * ① `keyTouched` 闸门 —— 初始为空（用户还没动过）一律不写，否则一开面板就把本机密钥抹了；
   * ② 防抖 800ms —— 逐键不写盘，写完最后一位才算数；
   * ③ 清空即撤销 —— 空串是合法入参，语义为「从本机删除」，对应「我主动把他删了」。
   * 成功不弹提示（逐键刷屏比没提示更糟），结果只落在「本机密钥状态」那一行。
   */
  useEffect(() => {
    if (!keyTouched) return;
    const trimmed = apiKey.trim();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const status = await requestSaveCredentials({ apiKey: trimmed, endpoint: endpoint.trim() || undefined, model: model.trim() || undefined });
          setLocalCredentials(status);
          setKeyNote(trimmed ? '已自动写入本机，下次打开无需再填。' : '已从本机清除；重新填写即可再次常驻。');
        } catch (error) {
          setKeyNote(`未能写入本机私有配置：${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [apiKey, keyTouched, endpoint, model]);

  /** 传给 memo 化面板的稳定回调：避免函数引用变化让子面板失去 memo 收益。 */
  const onMessage = useCallback((next: string) => setMessage(next), []);

  /**
   * 生成作业控制：暂停 / 继续 / 终止。
   * 作业在每个**分片边界**（每集、每段之间）调用 `checkpoint()`：
   * 先检查是否已终止，再在暂停态挂起（不占 CPU），最后让出一帧。已完成的分片结果已落库，暂停与终止都不丢。
   */
  const job = useRef<{ state: JobState; resume: (() => void) | null }>({ state: 'idle', resume: null });
  const [jobState, setJobState] = useState<JobState>('idle');
  const checkpoint = async (): Promise<void> => {
    // 每次现读作业状态：暂停/终止由界面按钮异步改写，不能依赖上一行的收窄结果。
    const now = (): JobState => job.current.state;
    if (now() === 'idle') throw jobStopped;
    if (now() === 'paused') {
      await new Promise<void>((resolve) => { job.current.resume = resolve; });
      if (now() === 'idle') throw jobStopped;
    }
    await yieldToMain();
  };
  const beginJob = () => { job.current = { state: 'running', resume: null }; setJobState('running'); };
  const endJob = (state: JobState = 'idle') => { job.current = { state, resume: null }; setJobState(state); };
  const pauseJob = () => {
    if (job.current.state !== 'running') return;
    job.current = { state: 'paused', resume: null };
    setJobState('paused');
    setMessage('已暂停；点「继续」接着生成，或「终止」保留已完成的部分');
  };
  const resumeJob = () => {
    if (job.current.state !== 'paused') return;
    const release = job.current.resume;
    job.current = { state: 'running', resume: null };
    setJobState('running');
    release?.();
  };
  /** 终止 = 把作业状态置回 idle，`checkpoint()` 随即抛哨兵让当前分片收尾并退出。 */
  const stopJob = () => {
    if (job.current.state === 'idle') return;
    const release = job.current.resume;
    job.current = { state: 'idle', resume: null };
    setJobState('idle');
    release?.();
  };

  /**
   * AI 主路径的可用性判定：开关打开 + 地址与模型就绪 + 密钥可解析（手填或本机已配置）。
   * 就绪则一键生成 / 选择集生成以 AI 逐段依次推理为主，本地规则只作单段兜底；否则一律走本地。
   */
  const aiTarget = (): AiTarget | null => {
    const name = model.trim();
    if (!aiEnabled || !endpoint.trim() || !name) return null;
    if (!apiKey.trim() && localCredentials?.configured !== true) return null;
    return { endpoint: endpoint.trim(), apiKey: apiKey.trim(), model: name, effort };
  };
  /** 渲染期只读判定：界面据此说明当前主路径，不参与任何计算。 */
  const aiReady = aiTarget() !== null;

  /**
   * 打开「选择集生成」浮层：默认只勾当前集 —— 「补跑一集」是最常见的诉求，
   * 要整本重跑就点全选。一个按钮不再背「本集」与「全本」两种互相打架的语义。
   */
  const openPicker = () => {
    if (!project) return;
    setPickedEpisodes([activeEpisode(project).id]);
    setPickerOpen(true);
  };
  const togglePicked = (episodeId: string, checked: boolean) => {
    setPickedEpisodes((old) => (checked ? (old.includes(episodeId) ? old : [...old, episodeId]) : old.filter((id) => id !== episodeId)));
  };

  async function openFile() {
    try {
      let file: { path: string; kind: 'docx' | 'text'; content: string } | null = null;
      if (window.workbench) file = await window.workbench.open();
      else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.md,.json,.docx,.doc,.rtf';
        file = await new Promise((resolve, reject) => {
          input.onchange = async () => {
            try {
              const selected = input.files?.[0];
              if (!selected) { resolve(null); return; }
              const bytes = new Uint8Array(await selected.arrayBuffer());
              // 与主进程同一判据：扩展名不可信，伪装成 .txt 的 docx 必须按魔数分流。
              const kind = sniffScriptPayload(bytes);
              resolve({ path: selected.name, kind, content: kind === 'docx' ? toBase64(bytes) : normalizeScriptText(decodeScriptBytes(bytes)) });
            } catch (error) { reject(error); }
          };
          input.oncancel = () => resolve(null);
          input.click();
        });
      }
      if (!file) return;
      if (file.path.toLowerCase().endsWith('.json')) store.setProject(projectSchema.parse(JSON.parse(file.content)));
      else {
        const content = file.kind === 'docx' ? await readWord(wordBytes(file.content).buffer) : file.content;
        if (file.kind === 'text' && /\.(?:md|markdown)$/iu.test(file.path)) {
          const lines = content.split('\n');
          const hasDialogue = lines.some((line) => /^\s*[^#：:\n]{1,20}[：:]/u.test(line) && !/^\s*\*\*/u.test(line));
          if (!hasDialogue && isMarkdownBrief(content)) throw new Error('当前文件是 Markdown 说明/方案文档，不是可拆分剧本；请导入含人物台词或动作正文的剧本文件');
        }
        store.importScript(content, file.path.split(/[\\/]/).at(-1) ?? '导入剧本');
      }
      setAnalyses(new Map()); setMatchNote('');
      setMessage('文件已打开');
    } catch (error) { setMessage(`导入失败：${String(error)}`); }
  }
  async function clearWorkspace() {
    if (!window.confirm('清空工作台缓存、当前项目和本地草稿？此操作不可恢复。')) return;
    await store.clearWorkspace();
    setAnalyses(new Map()); setMatchNote(''); setMessage('工作台已清空');
  }
  async function saveProject() {
    if (!project) return;
    try {
      const content = JSON.stringify(project, null, 2);
      if (window.workbench) { const path = await window.workbench.saveProject(content); if (path) setMessage(`项目已保存：${path}`); }
      else download(`${project.title}-项目.json`, content, 'application/json');
    } catch (error) { setMessage(`项目保存失败：${String(error)}`); }
  }
  /**
   * 导出前置判定：只对「本集阻断项」设闸——本集干净即可导出，
   * 其他集的问题不拖累本集；本集有阻断时打开全书清单给出明确条目与跳转。
   */
  function exportTarget(episodeId?: string): Episode | null {
    const before = useWorkbench.getState().project; if (!before) return null;
    const prepared = store.prepareForExport(episodeId);
    if (prepared.repairedEpisodes.length || prepared.generatedFields) {
      setMessage(`已自动修复 ${prepared.repairedEpisodes.length} 集并生成 ${prepared.generatedFields} 个字段，正在校验导出`);
    }
    const current = useWorkbench.getState().project; if (!current) return null;
    const target = (episodeId ? current.episodes.find((item) => item.id === episodeId) : undefined) ?? activeEpisode(current);
    const blocked = validate(current, target.id).filter((issue) => issue.severity === 'error');
    if (blocked.length) {
      setGateOpen(true);
      setMessage(`${target.label} 有 ${blocked.length} 项阻断，请在全书清单中逐条处理后导出；其余无阻断的集仍可直接导出`);
      return null;
    }
    return target;
  }
  async function exportFile(episodeId?: string) {
    const target = exportTarget(episodeId); if (!target) return;
    // exportTarget 内部会先做自动修复与生成并更新快照：必须取它之后的最新 project，
    // 否则会用「修复前」的旧快照校验，把已修复的集误判为仍被阻断。
    const current = useWorkbench.getState().project; if (!current) return;
    try {
      const result = exportBundle(current, target.id);
      if (window.workbench) { const path = await window.workbench.saveExport(result.text); if (path) setMessage(`TXT 分镜已导出：${path}`); }
      else { download(`${current.title}-${target.label}-H3分镜.txt`, result.text, 'text/plain;charset=utf-8'); setMessage(`${target.label} TXT 分镜已导出（浏览器下载）`); }
    } catch (error) { setGateOpen(true); setMessage(String(error)); }
  }
  async function exportWord(episodeId?: string) {
    const target = exportTarget(episodeId); if (!target) return;
    // 同上：导出校验必须基于自动修复后的最新快照。
    const current = useWorkbench.getState().project; if (!current) return;
    try {
      exportBundle(current, target.id);
      const bytes = await writeWord(current, target.id);
      if (window.workbench) { const path = await window.workbench.saveWord(Array.from(bytes)); if (path) setMessage(`Word 已导出：${path}`); }
      else { download(`${current.title}-${target.label}-H3分镜.docx`, new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); setMessage(`${target.label} Word 分镜已导出（浏览器下载）`); }
    } catch (error) { setGateOpen(true); setMessage(`Word 导出失败：${String(error)}`); }
  }
  /**
   * 导出**当前片段**（P ≡ 15 秒一段）。
   *
   * 与整集导出有两条刻意保留的差异：
   * ① **不调用 `prepareForExport`** —— 那个函数对整集跑一遍结构修复与规则生成再回填，会顺带改动
   *    别的段（`directorGenerated` 自 2026-10-06 起是派生值：只有真写进字段的段才算已生成，
   *    但「别的段被补齐了内容」本身仍是用户没要求的事）。用户只想拿走弄好的这一片，
   *    不该因此让整集发生变化。
   * ② **闸门只认本段 ＋ 集级事实类 error** —— 别的段还没弄好不该拖住这一片；但原稿层已坏
   *    （台词被改 / 节拍遗漏 / 结构不一致）时，任何片段都不放行。
   *
   * 两条链路共用 `exportBundle` 这一个出口，故片段的「阻断判定」与整集完全同源，
   * 不存在第二套闸门。
   */
  async function exportSegment(segmentId: string, format: 'word' | 'txt') {
    const current = useWorkbench.getState().project; if (!current) return;
    const episode = activeEpisode(current);
    if (!episode.segments.some((item) => item.id === segmentId)) { setMessage(`片段 ${segmentId} 不存在，无法导出`); return; }
    const blocked = validate(current, episode.id).filter((issue) => issue.severity === 'error' && (!issue.segmentId || issue.segmentId === segmentId));
    if (blocked.length) {
      setGateOpen(true);
      setMessage(`${segmentId} 有 ${blocked.length} 项阻断，请在全书清单中逐条处理后导出`);
      return;
    }
    try {
      const result = exportBundle(current, episode.id, segmentId);
      if (format === 'txt') {
        if (window.workbench) { const path = await window.workbench.saveExport(result.text); if (path) setMessage(`片段 TXT 已导出：${path}`); }
        else { download(`${current.title}-${episode.label}-${segmentId}-H3分镜.txt`, result.text, 'text/plain;charset=utf-8'); setMessage(`${segmentId} TXT 片段已导出（浏览器下载）`); }
        return;
      }
      const bytes = await writeWord(current, episode.id, segmentId);
      if (window.workbench) { const path = await window.workbench.saveWord(Array.from(bytes)); if (path) setMessage(`片段 Word 已导出：${path}`); }
      else { download(`${current.title}-${episode.label}-${segmentId}-H3分镜.docx`, new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); setMessage(`${segmentId} Word 片段已导出（浏览器下载）`); }
    } catch (error) { setGateOpen(true); setMessage(`片段导出失败：${String(error)}`); }
  }
  async function testConnection() {
    if (!endpoint.trim()) { setConnection({ ok: false, message: '请先填写接口地址（到 /v1 一级）' }); return; }
    if (!apiKey.trim() && localCredentials && !localCredentials.configured) { setConnection({ ok: false, message: '请填写密钥，或在工程目录的 .env.local 配置 WORKBENCH_API_KEY' }); return; }
    setConnection({ ok: true, message: '正在接入并拉取该密钥的模型…' });
    try {
      // 填了就用填的；留空则由主进程回落到本机私有配置。
      const result = await requestConnectionTest({ endpoint: endpoint.trim(), apiKey: apiKey.trim() || undefined, model: model.trim() || undefined });
      setConnection(result);
      // 接入成功即把该密钥可见的模型灌入下拉框；当前模型不在列表里就自动选中第一个。
      if (result.models?.length) {
        setModelOptions(result.models);
        if (!result.models.includes(model.trim())) saveSettings({ model: result.models[0] });
      } else setModelOptions([]);
    }
    catch (error) { setConnection({ ok: false, message: `接入失败：${String(error)}` }); }
  }

  /** 本地引擎 A：逐图分析（图类 / 主体 / 光影色彩），零 API，可对任意一集执行。 */
  async function analyzeLocal(library: ReferenceImage[], target: Episode, prefix: string, base: number, span: number): Promise<Map<string, ImageAnalysis>> {
    const roster = subjectRoster(buildRoster(target));
    const result = new Map<string, ImageAnalysis>();
    const head = prefix ? `${prefix} · 本地图像分析` : '本地图像分析';
    for (const [index, image] of library.entries()) {
      setProgress({ running: true, label: `${head} ${index + 1}/${library.length}`, value: base + (library.length ? (index / library.length) * span : span) });
      // 像素统计按图缓存、跨集复用；逐集只重算「主体是否命中本集名册」。
      result.set(image.id, analyzeWithStats({ name: image.name }, await pixelStatsOf(image), roster));
    }
    return result;
  }

  /**
   * 一键生成（本集）：本地识别 → 自动匹配 → 生成导演意图与正文字段。
   * **AI 就绪时以「AI 逐段依次推理」为主路径**（跳过本地预生成，段间传递 ⑦光/⑨站位/⑭衔接 上下文），
   * 单段失败只回退该段的本地规则结果；**AI 不可用时退回纯本地**（保底）。
   */
  async function oneClick() {
    if (!project || busy) return;
    const target = activeEpisode(project);
    setBusy(true); setMatchNote(''); beginJob();
    try {
      setProgress({ running: true, label: '本地图像分析', value: 0 });
      const local = await analyzeLocal(project.assets, target, '', 0, 0.4);
      setAnalyses(local);
      await checkpoint();

      setProgress({ running: true, label: '参考图自动匹配', value: 0.5 });
      const roster = buildRoster(target);
      const outcomes = matchImages(project.assets, target, local, roster);
      store.applyMatch(outcomes.map((outcome) => ({ imageId: outcome.imageId, segmentIds: outcome.segmentIds, confidence: outcome.confidence, source: outcome.source, reason: outcome.reason })));
      const unassignedCount = outcomes.filter((outcome) => !outcome.segmentIds.length).length;
      const mediumCount = outcomes.filter((outcome) => outcome.confidence === 'medium').length;
      setMatchNote(`匹配完成：${outcomes.length} 张图，中置信度 ${mediumCount} 张需复核，未分配 ${unassignedCount} 张`);

      const ai = aiTarget();
      if (ai) {
        // AI 主路径：本地规则只作为「单段兜底」与「导演意图」来源，不预先整体写入。
        let localDrafts: Map<string, ShotDraft[]> | null = null;
        const localFor = (segmentId: string) => (localDrafts ??= generateEpisodeDrafts(project, target, local)).get(segmentId) ?? [];
        let aiFilled = 0; let aiSegments = 0; let fallback = 0; let rejected = 0; let protectedShots = 0;
        /** 本次各段失败原因（去重后进提示条）：AI 全失败时，界面必须说得出「为什么」而不是只报「已回退本地」。 */
        const failures: string[] = [];
        let previous = emptyContext;
        for (const [index, item] of target.segments.entries()) {
          await checkpoint();
          setProgress({ running: true, label: `AI 依次推理 ${index + 1}/${target.segments.length}（${item.id}）`, value: 0.55 + (index / Math.max(1, target.segments.length)) * 0.4 });
          try {
            const base = localFor(item.id);
            const purposeById = new Map(base.map((draft) => [draft.shotId, draft.purpose]));
            const result = await aiSegmentDrafts(project, target, item, ai, previous, base);
            /**
             * 导演意图由本地规则派生（AI 不产出 purpose），与 AI 字段合并后一次写入。
             * 走 `applyGenerationBatch`（与 `applyGenerated` 等价，都指向唯一写入口）而不是后者：
             * 它额外回传 `protectedShots` —— 0 条字段时界面要靠这个数说清「为什么没写」。
             */
            const written = store.applyGenerationBatch(
              [{ episodeId: target.id, drafts: [{ segmentId: item.id, drafts: result.drafts.map((draft) => ({ ...draft, purpose: purposeById.get(draft.shotId) })) }] }],
              { overwrite, source: 'ai' },
            );
            aiFilled += written.filled; protectedShots += written.protectedShots;
            rejected += result.rejected;
            previous = contextAfter(result.drafts, previous);
            aiSegments += 1;
          } catch (error) {
            const list = localFor(item.id);
            if (list.length) {
              store.applyGenerated(item.id, list, { overwrite, source: 'local' });
              // 回退段也是**板上真实的上段结果**，必须进上下文链 —— 否则下一段会按一个不在板上的
              // 状态续写（⑦光源链路 / ⑨左右关系对不上），跨段一致性反而更差。
              previous = contextAfter(list, previous);
            }
            failures.push(errorNote(error));
            fallback += 1;
          }
        }
        const rejectedNote = rejected ? `，${rejected} 镜因写出名册外姓名已改用本地结果` : '';
        const protectedNote = protectedShots ? `，${protectedShots} 镜为人工改过或已锁定、未改写` : '';
        // 0 条字段时不得再报「校验通过」—— 那会让「AI 什么都没写」看起来像一次成功（老大 2026-10-06 报的那一幕）。
        setMessage(fallback
          ? `AI 依次推理完成 ${aiSegments} 段（${aiFilled} 条字段）${rejectedNote}，${fallback} 段未通过已回退本地规则结果${failureNoteOf(failures)}`
          : aiFilled === 0
            ? `AI 依次推理完成 ${aiSegments} 段，但 0 条字段写入导演板${protectedShots ? `${protectedNote}，生成通道不改写人的结果` : '（AI 未返回有效字段，请检查模型输出）'}`
            : `AI 依次推理完成 ${aiSegments} 段，生成 ${aiFilled} 条字段${rejectedNote}${protectedNote}，校验通过`);
      } else {
        setProgress({ running: true, label: '规则导演自动生成意图与正文', value: 0.7 });
        await checkpoint();
        const drafts = generateEpisodeDrafts(project, target, local);
        /**
         * 一次批量写入（与选集生成共用 `applyGenerationBatch` 这唯一写入口）：
         * 既省掉 N 段各自一次落盘，也让「本次新标记了几段」这个数拿得准 ——
         * 段级「已生成」是派生值，只有真正写进了字段的段才会从「未生成」变成「已生成」。
         */
        const result = store.applyGenerationBatch(
          [{ episodeId: target.id, drafts: [...drafts].map(([segmentId, list]) => ({ segmentId, drafts: list })) }],
          { overwrite, source: 'local' },
        );
        setMessage(`本地规则导演已填充 ${result.filled} 条字段，新标记 ${result.segments} 段导演决策已生成${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);
      }
    } catch (error) {
      if (error === jobStopped) setMessage('已终止；已完成的部分保留在导演板上');
      else setMessage(`一键生成失败：${String(error)}`);
    }
    finally { setBusy(false); setProgress(null); endJob(); }
  }

  /**
   * 重新生成本 P（P4 第二小步 b）：**只重跑本段**的 ③–⑭，不触碰其他段，也不重跑资产匹配
   * （① ② ④ 读的是段上已绑定的资产，匹配是资产侧的事，改了会让别的段跟着变）。
   *
   * 判据与整集生成**共用同一套**：本地走 `generateEpisodeDrafts` 的该段结果；AI 就绪时走
   * `aiSegmentDrafts`，**上下文取上一段的板上结果**（不是空上下文）—— 单段修补同样要保持
   * ⑦ 光源链路与 ⑨ 左右关系连续，否则这一段会「跳」出整集的影调与轴线。
   *
   * 覆盖语义沿用顶栏「覆盖已有内容」开关：未勾选时只补空白，人工改写过的字段不会被冲掉。
   */
  async function regenerateSegment(segmentId: string) {
    const current = useWorkbench.getState().project;
    if (!current || busy) return;
    const target = activeEpisode(current);
    const index = target.segments.findIndex((item) => item.id === segmentId);
    if (index < 0) return;
    const item = target.segments[index];
    setBusy(true); setMatchNote(''); beginJob();
    try {
      setProgress({ running: true, label: `重新生成本 P（${item.id}）`, value: 0.2 });
      // 逐图分析按像素缓存跨集复用，这里重算的是「主体是否命中本集名册」那一半，成本与集数无关。
      const local = await analyzeLocal(current.assets, target, '', 0, 0.55);
      setAnalyses(local);
      await checkpoint();

      const base = generateEpisodeDrafts(current, target, local).get(item.id) ?? [];
      const ai = aiTarget();
      let filled = 0; let protectedShots = 0;
      if (ai) {
        setProgress({ running: true, label: `AI 依次推理 ${item.id}`, value: 0.75 });
        const previous = contextAfter(draftsOnBoard(target.segments[index - 1]), emptyContext);
        try {
          // 导演意图仍由本地规则派生（AI 不产出 purpose），与整集路径一致。
          const purposeById = new Map(base.map((draft) => [draft.shotId, draft.purpose]));
          const result = await aiSegmentDrafts(current, target, item, ai, previous, base);
          const written = store.applyGenerationBatch(
            [{ episodeId: target.id, drafts: [{ segmentId: item.id, drafts: result.drafts.map((draft) => ({ ...draft, purpose: purposeById.get(draft.shotId) })) }] }],
            { overwrite, source: 'ai' },
          );
          filled = written.filled; protectedShots = written.protectedShots;
          const rejectedNote = result.rejected ? `，${result.rejected} 镜因写出名册外姓名已改用本地结果` : '';
          const protectedNote = protectedShots ? `，${protectedShots} 镜为人工改过或已锁定、未改写` : '';
          setMessage(filled === 0
            ? `已重新生成 ${item.id}：AI 依次推理完成，但 0 条字段写入导演板${protectedShots ? `${protectedNote}，生成通道不改写人的结果` : '（AI 未返回有效字段，请检查模型输出）'}`
            : `已重新生成 ${item.id}：AI 依次推理填充 ${filled} 条字段${rejectedNote}${protectedNote}`);
        } catch (error) {
          // 终止哨兵要冒泡给外层统一收尾；其余（网络 / 解析 / 契约）失败一律回退本段本地结果。
          if (error === jobStopped) throw error;
          filled = base.length ? store.applyGenerated(item.id, base, { overwrite, source: 'local' }) : 0;
          setMessage(`已重新生成 ${item.id}：AI 未通过已回退本地规则结果（${filled} 条字段）${failureNoteOf([errorNote(error)])}`);
        }
      } else {
        setProgress({ running: true, label: `规则导演重算 ${item.id}`, value: 0.75 });
        await checkpoint();
        filled = base.length ? store.applyGenerated(item.id, base, { overwrite, source: 'local' }) : 0;
        setMessage(`已重新生成 ${item.id}：本地规则填充 ${filled} 条字段${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);
      }
    } catch (error) {
      if (error === jobStopped) setMessage('已终止；本 P 未改动');
      else setMessage(`重新生成本 P 失败：${String(error)}`);
    }
    finally { setBusy(false); setProgress(null); endJob(); }
  }

  /**
   * 选集生成：只对**指定的集**逐集做图像分析 → 匹配 → 生成，一次写入并标记每段「导演决策已生成」。
   * **AI 就绪时逐集逐段依次推理**（单段失败只回退该段本地结果），否则整体走本地规则；单集失败隔离，不阻断其余集。
   */
  async function generateEpisodes(episodeIds: string[]) {
    if (!project || busy || !episodeIds.length) return;
    const book = project;
    // 按工程内的集序处理，不按勾选顺序：AI 依次推理的上下文链必须与剧集顺序一致。
    const targets = book.episodes.filter((item) => episodeIds.includes(item.id));
    const total = targets.length;
    if (!total) return;
    setBusy(true); setMatchNote(''); beginJob();
    /**
     * 分批写入：`batchSize` 集凑够一批就用唯一写入口落库一次。
     * 分批有两个目的：① 终止时已完成批次已在库里；② 写入本身是一次同步合并，
     * 实测 8 集一批会压出约 1 秒的单次阻塞，收到 3 集一批后单次阻塞降到几百毫秒。
     */
    const batchSize = 3;
    const pending: GenerationBatchEntry[] = [];
    let processed = 0; let written = 0; let filled = 0; let segmentsWritten = 0; let protectedTotal = 0;
    /** 各段失败原因（去重后进提示条）：与单集路径同一条纪律 —— 失败必须说得出原因。 */
    const failures: string[] = [];
    const flush = () => {
      if (!pending.length) return;
      written += pending.length;
      const result = store.applyGenerationBatch(pending.splice(0), { overwrite, source: 'local' });
      filled += result.filled; segmentsWritten += result.segments; protectedTotal += result.protectedShots;
    };
    try {
      const ai = aiTarget();
      const analysisByEpisode = new Map<string, Map<string, ImageAnalysis>>();
      let failed = 0; let aiSegments = 0; let fallbackSegments = 0; let rejected = 0;
      for (const [index, item] of targets.entries()) {
        await checkpoint();
        try {
          const slot = 0.9 / total;
          if (!item.segments.length) continue;
          const local = await analyzeLocal(book.assets, item, item.label, index * slot, slot * 0.5);
          analysisByEpisode.set(item.id, local);
          const outcomes = matchImages(book.assets, item, local, buildRoster(item));
          // 本地规则结果始终计算：AI 主路径下它既提供导演意图，也作为单段兜底。
          const localDrafts = generateEpisodeDrafts(book, item, local);
          const drafts: { segmentId: string; drafts: ShotDraft[] }[] = [];
          if (ai) {
            let previous = emptyContext;
            for (const [segmentIndex, segment] of item.segments.entries()) {
              await checkpoint();
              setProgress({ running: true, label: `${item.label} · AI 依次推理 ${segmentIndex + 1}/${item.segments.length}`, value: index * slot + slot * (0.6 + 0.4 * (segmentIndex / Math.max(1, item.segments.length))) });
              const base = localDrafts.get(segment.id) ?? [];
              try {
                const purposeById = new Map(base.map((draft) => [draft.shotId, draft.purpose]));
                const result = await aiSegmentDrafts(book, item, segment, ai, previous, base);
                drafts.push({ segmentId: segment.id, drafts: result.drafts.map((draft) => ({ ...draft, purpose: purposeById.get(draft.shotId) })) });
                rejected += result.rejected;
                previous = contextAfter(result.drafts, previous);
                aiSegments += 1;
              } catch (error) {
                if (base.length) {
                  drafts.push({ segmentId: segment.id, drafts: base });
                  // 同单集路径：回退段的结果同样进上下文链（板上真实状态优先于「AI 的理想状态」）。
                  previous = contextAfter(base, previous);
                }
                failures.push(errorNote(error));
                fallbackSegments += 1;
              }
            }
          } else {
            setProgress({ running: true, label: `${item.label} · 参考图自动匹配与规则导演生成`, value: index * slot + slot * 0.6 });
            drafts.push(...[...localDrafts].map(([segmentId, list]) => ({ segmentId, drafts: list })));
          }
          pending.push({
            episodeId: item.id,
            assignments: outcomes.map((outcome) => ({ imageId: outcome.imageId, segmentIds: outcome.segmentIds, confidence: outcome.confidence, source: outcome.source, reason: outcome.reason })),
            drafts,
          });
          processed += 1;
          if (pending.length >= batchSize) { setProgress({ running: true, label: `已写入 ${processed}/${total} 集`, value: index * slot + slot }); flush(); await checkpoint(); }
        } catch (error) {
          // 终止哨兵必须冒泡给外层统一收尾（否则会被记成「这一集失败」并继续跑下一集）。
          if (error === jobStopped) throw error;
          failures.push(errorNote(error));
          failed += 1;
        }
      }
      await checkpoint();
      setProgress({ running: true, label: '写入剩余分集并标记已生成', value: 0.95 });
      flush();
      setAnalyses(analysisByEpisode.get(activeEpisode(book).id) ?? new Map());
      setMatchNote(`选集生成完成：处理 ${processed}/${total} 集，填充 ${filled} 条字段，${segmentsWritten} 段新标记为已生成${failed ? `，${failed} 集失败已隔离` : ''}`);
      setMessage(ai
        ? `选集生成完成：${processed}/${total} 集，AI 依次推理 ${aiSegments} 段${rejected ? `（${rejected} 镜因写出名册外姓名改用本地结果）` : ''}${fallbackSegments ? `，${fallbackSegments} 段回退本地${failureNoteOf(failures)}` : ''}${protectedTotal ? `，${protectedTotal} 镜为人工改过或已锁定、未改写` : ''}${failed ? `，${failed} 集失败已隔离` : ''}`
        : `选集生成完成：${processed}/${total} 集逐集分析并回填，${segmentsWritten} 段新标记为已生成${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);
    } catch (error) {
      // 终止：把已完成但还没凑满一批的集也写进去，已做的推理一律不丢。
      if (error === jobStopped) {
        flush();
        setMessage(`已终止：已完成 ${written}/${total} 集并写入导演板，其余未处理；点「选择集生成」可继续补齐剩下的集`);
      } else setMessage(`选集生成失败：${String(error)}`);
    }
    finally { setBusy(false); setProgress(null); endJob(); }
  }

  /**
   * 进度面板：生成作业的运行面板，带暂停 / 继续 / 终止。
   * 暂停与终止都停在分片边界上，已完成的分片结果已落库，不会回退。
   */
  const progressPanel = progress && <div className="progress-panel"><strong role="status">{progress.label}</strong><div className="progress-track"><div style={{ width: `${Math.round(progress.value * 100)}%` }} /></div>{busy && <div className="progress-actions">{jobState === 'paused'
    ? <button onClick={resumeJob}>继续</button>
    : <button onClick={pauseJob}>暂停</button>}<button onClick={stopJob}>终止</button></div>}</div>;

  /** 左栏摘要行的计数：资产按类数、原稿字数、「人物设定与弧光」段的人数与锚点确认状态。 */
  const assetCounts = {
    character: assets.filter((image) => image.kind === 'character').length,
    scene: assets.filter((image) => image.kind === 'scene').length,
  };
  const castCount = castNamesOf(assets).length;
  const sourceSummary = `${sourceText.length >= 10000 ? `${(sourceText.length / 10000).toFixed(1)} 万字` : `${sourceText.length} 字`}${sourceDirty ? ' · 未保存' : ''}`;

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">分</span><div><strong>剧本拆分工作台</strong><small>MINIMAX H3 / 分镜正本</small></div></div>
      {/**
        * 模式分段控件（P4 定稿 · 2026-10-06）：顶栏**只留一处**引擎状态。
        * 定稿决策句要求「去掉与模式开关重复的状态标识」，故这里不再另设一枚独立的
        * 「AI 已就绪 / 本地」标识 —— 选中态本身就是唯一的状态呈现。
        * 它不是一个纯显示：点「本地」即关掉 AI 增强（真回本地），点「AI」在未就绪时
        * 直接把「接口设置」打开（而不是给一句无法照做的提示）。
        */}
      <div className="engine-switch" role="group" aria-label="生成引擎">
        <button className={aiReady ? '' : 'active'} aria-pressed={!aiReady} title="本地规则引擎：全程本机、零 API，走判据包里的规则表" onClick={() => { if (aiEnabled) { saveSettings({ ai: false }); setMessage('已切回本地规则引擎'); } }}>本地</button>
        <button className={aiReady ? 'active' : ''} aria-pressed={aiReady} title="AI 依次推理：逐段调用文本模型，单段失败回退本地规则结果" onClick={() => {
          if (!aiTarget()) { setSettingsOpen(true); setMessage(aiEnabled ? 'AI 尚未就绪：请补齐接口地址、模型与密钥' : '请先在「接口设置」中填写接口地址、选择模型并启用 AI 增强'); return; }
          setMessage('当前主路径：AI 逐段依次推理');
        }}>AI</button>
      </div>
      <div className="toolbar">
        <button onClick={openFile} title="导入 TXT、Markdown、Word 或项目快照"><FileInput size={17} />导入</button>
        <button onClick={() => void clearWorkspace()} title="清空当前项目与本地缓存"><Trash2 size={17} />清空</button>
        <button onClick={() => { store.importScript(sample, '验收样例'); setAnalyses(new Map()); setMessage('样例已载入，导演字段等待确认'); }} title="载入验收样例"><FilePlus2 size={17} />样例</button>
        <button className={`primary${aiReady ? ' ai-ready' : ''}`} aria-label="一键生成" data-ai={aiReady ? 'ready' : 'local'} onClick={oneClick} disabled={!project || busy} title={aiReady ? '本集：本地识别 → 匹配 → AI 逐段依次推理（单段失败回退本地规则）' : '本集：本地识别 → 自动匹配 → 规则导演生成（接入 AI 后将改为 AI 依次推理）'}>{aiReady ? <Bot size={17} /> : <Sparkles size={17} />}{aiReady ? 'AI 依次推理' : '一键生成'}</button>
        <button onClick={openPicker} disabled={!project || busy} title={aiReady ? '勾选要生成的集，逐集逐段 AI 依次推理，单段失败回退本地规则' : '勾选要生成的集，逐集分析并回填，逐段标记导演决策已生成'}><ListChecks size={17} />选择集生成</button>
        <button onClick={() => setSettingsOpen(true)} title="配置可选 AI 增强接口"><Settings size={17} />接口设置</button>
        <button onClick={saveProject} disabled={!project} title="保存可恢复的项目快照"><Save size={17} />保存项目</button>
        <button onClick={() => void exportFile()} disabled={!project || busy} title={errors.length ? `本集 ${errors.length} 项阻断，点击查看全书清单` : '导出本集 TXT 分镜'}><Download size={17} />导出 TXT</button>
        <button onClick={() => void exportWord()} disabled={!project || busy} title={errors.length ? `本集 ${errors.length} 项阻断，点击查看全书清单` : '导出本集 Word 分镜'}><Download size={17} />导出 Word</button>
      </div>
    </header>
    {settingsOpen && <SettingsPanel aiEnabled={aiEnabled} aiReady={aiReady} endpoint={endpoint} apiKey={apiKey} model={model} effort={effort} modelOptions={modelOptions} localCredentials={localCredentials} connection={connection} keyNote={keyNote} onSave={saveSettings} onTestConnection={() => void testConnection()} onClose={() => setSettingsOpen(false)} />}
    {gateOpen && project && gate && <GatePanel project={project} gate={gate} ignoredGateIssues={ignoredGateIssues} onAddIgnored={(keys) => setIgnoredGateIssues((old) => new Set([...old, ...keys]))} onResetIgnored={() => setIgnoredGateIssues(new Set())} onRepair={repairBlocked} onExportFile={(episodeId) => void exportFile(episodeId)} onExportWord={(episodeId) => void exportWord(episodeId)} onClose={() => setGateOpen(false)} />}
    {pickerOpen && project && <EpisodePicker project={project} pickedEpisodes={pickedEpisodes} aiReady={aiReady} busy={busy} onToggle={togglePicked} onSetPicked={setPickedEpisodes} onGenerate={(ids) => void generateEpisodes(ids)} onClose={() => setPickerOpen(false)} />}
    {storageError && <div className="save-warning" role="alert">本地存档读取失败：磁盘上仍有这份存档（未被覆盖），但当前版本读不出来，所以工作台显示为空。请先「保存项目」或手工备份原存档，再开始新的编辑 —— 直接编辑并自动保存会覆盖掉它。</div>}
    {!storageReady ? <main className="empty-workspace" aria-busy="true"><div className="empty-icon"><Loader2 size={32} className="spin" /></div><h1>正在载入本地存档…</h1><p>{slowLoad ? '这份存档较大，正在装回参考图并重建分集，请稍候（请勿关闭窗口）。' : '正在读取本地存档。'}</p></main> : !project ? <main className="empty-workspace"><div className="empty-icon"><PanelRight size={32} /></div><h1>从原剧本开始</h1><p>导入整本剧本与批量参考图片，一键生成本地识别的 14 条分镜；AI 增强为可选项。</p><div className="empty-actions"><button className="primary" onClick={openFile}><FileInput size={17} />导入剧本</button><button onClick={() => { store.importScript(sample, '验收样例'); }}><Play size={17} />打开样例</button><button onClick={() => setSettingsOpen(true)}><Settings size={17} />接口设置</button></div></main> : episode && <>
      <div className="episode-bar">
        <div className="episode-list">{project.episodes.map((item) => <button key={item.id} className={item.id === episode.id ? 'active' : ''} onClick={() => store.selectEpisode(item.id)} title={item.label}>{item.label}<small>{item.segments.length} 段</small></button>)}</div>
        <div className="episode-note"><span className="episode-note-text">{project.episodes.length > 1 ? `已自动识别 ${project.episodes.length} 集` : '未识别到集标，已按整本单集处理；展开左栏「分集清单」核对切点'}</span>{!episode.splitVerified && <button onClick={() => store.verifySplit()}>核对分集</button>}</div>
      </div>
      <div className="projectbar"><div><input aria-label="作品名称" value={project.title} onChange={(event) => store.setProject({ ...project, title: event.target.value || '未命名作品' }, false)} /><span className="episode">{episode.label}</span><span className="tag">{typeNames[project.contentType]}</span></div><div className="project-controls"><span className={`validation-status ${validationState}`}>{validationState === 'validating' ? '正在校验…' : validationState === 'ready' ? '校验完成' : ''}</span><label>整集规划模式 <select aria-label="整集规划模式" value={project.defaultMode} onChange={(event) => store.setMode(event.target.value as DefaultMode)}>{Object.entries(modeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>内容类型 <select aria-label="内容类型" value={project.contentType} onChange={(event) => store.setProject({ ...project, contentType: event.target.value as typeof project.contentType }, false)}>{Object.entries(typeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="overwrite" title="仅约束「本地规则」生成：勾选后本地稿也会改写已有内容。AI 主路径不受此开关限制 —— 点「AI 依次推理」即以 AI 稿为准，唯一不改的是人工改过与已锁定的镜头。"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />覆盖已有内容</label><button onClick={() => { if (window.confirm('重新规划将替换所有未另存的导演板编辑。继续？')) store.replan(); }} title="按当前原稿和模式重新拆段">重新规划</button></div></div>
    {autosaveError && <div className="save-warning" role="alert">本地存档写入失败，当前改动未自动保存。请立即“保存项目”留存 JSON 快照。</div>}
    {splitStatus === 'rebuilt' && <div className="save-warning" role="status">这份存档的分集由 <strong>旧版识别口径</strong> 生成，已按当前版本自动重建为 {project.episodes.length} 集。若切点不符，请展开左栏「分集清单」核对，或点「重新规划」重来。</div>}
    {splitStatus === 'stale' && <div className="save-warning" role="alert">这份存档的分集由 <strong>旧版识别口径</strong> 生成；检测到已有导演板编辑 / 参考图 / 生成内容，<strong>未自动重建</strong>（避免覆盖你的工作）。请展开左栏「分集清单」确认；确认可重建后点「重新规划」（参考图会保留，导演板字段会重算）。</div>}
    {migrated && <div className="save-warning" role="status">已从 v1.0 单集存档自动迁移到 v1.1 多集结构（1 集），旧数据未丢失。</div>}
    {droppedProps > 0 && <div className="save-warning" role="alert">这份存档里有 <strong>{droppedProps} 张「道具」参考图</strong>，因「道具」图类已退役而被<strong>丢弃</strong>（老大 2026-10-06 裁定，不可撤销）；其余资产与全部导演板内容未受影响。</div>}
      <main className="workspace">
        {/**
          * P4 定稿（2026-10-06）：工作区收成**两栏** —— 左栏「输入与设定」+ 右栏「生成与审阅」。
          * 左栏四段一律**默认收起**、行右报摘要；生成区固定在左栏底部。
          * 集切换条与项目条留在全宽行上（它们是全局导航，不属于「输入与设定」的任一段）。
          */}
        <aside className="left-rail" aria-label="输入与设定">
          <div className="rail-title">输入与设定</div>
          <div className="rail-scroll">
            <Section name="剧本原稿" summary={sourceSummary} open={openScript} onToggle={() => setOpenScript(!openScript)}>
              <SourcePane projectId={project.id} sceneCount={episode.scenes.length} beatCount={episode.beats.length} filename={source?.filename ?? ''} scriptId={project.activeScriptId} sourceText={sourceText} onMessage={onMessage} onDirtyChange={setSourceDirty} />
            </Section>
            <Section name="分集清单" summary={`${project.episodes.length} 集`} open={splitOpen} onToggle={() => setSplitOpen(!splitOpen)}>
              <table className="split-table"><thead><tr><th>集号</th><th>标题</th><th>字数</th><th>场次</th><th>切点行号</th></tr></thead><tbody>
                {project.episodes.map((item, index) => <tr key={item.id} className={item.id === episode.id ? 'active' : ''}><td>{item.label}</td><td>{split?.episodes[index]?.title || '—'}</td><td>{split?.episodes[index]?.charCount ?? 0}</td><td>{item.scenes.length}</td><td>{split ? `${split.episodes[index]?.startLine}–${split.episodes[index]?.endLine}` : '—'}</td></tr>)}
              </tbody></table>
            </Section>
            <Section name="资产" summary={`人物 ${assetCounts.character} · 场景 ${assetCounts.scene}`} open={openAssets} onToggle={() => setOpenAssets(!openAssets)}>
              <AssetPane project={project} episode={episode} segment={segment} assets={assets} busy={busy} setBusy={setBusy} matchNote={matchNote} unassigned={unassigned} lowConfidence={lowConfidence} ai={{ endpoint, apiKey, effort, model }} setProgress={setProgress} onMessage={onMessage} />
            </Section>
            {/**
              * 人物设定与弧光：**仅 AI 模式渲染**（2026-10-06 老大裁定「严格按图 1」）。
              * 它是*入口*的分侧，不是数据的分侧 —— `project.visual` 数据侧两侧都在消费
              * （`skeleton.values()` 的文字兜底 / validator 的锚点判据），故本地只是填不了，
              * 老项目已有的锚点切到本地模式照常生效。
              * 摘要报**两件事**：按人物那半的**人数**（取自人物资产文件名）与锚点那半的确认状态 ——
              * 只报后者的话，填了人物设定而没确认锚点时摘要会一直写「未填写」，与眼前所见矛盾。
              */}
            {aiReady && <Section name="人物设定与弧光" summary={`人物 ${castCount} · ${project.visual.confirmed ? '已确认' : '未填写'}`} open={openCast} onToggle={() => setOpenCast(!openCast)}>
              <CastPane project={project} />
            </Section>}
          </div>
          <div className="gen-zone">
            {aiReady ? <span className="gen-zone-note ai-ready">主路径：AI 依次推理</span> : <span className="gen-zone-note">主路径：本地规则 · 零 API</span>}
            {progressPanel}
            <button className={`primary${aiReady ? ' ai-ready' : ''}`} aria-label="生成当前集" data-ai={aiReady ? 'ready' : 'local'} onClick={oneClick} disabled={!project || busy} title={aiReady ? '本集：本地识别 → 匹配 → AI 逐段依次推理（单段失败回退本地规则）' : '本集：本地识别 → 自动匹配 → 规则导演生成'}>生成当前集 · {aiReady ? 'AI 依次推理' : '本地规则'}</button>
          </div>
        </aside>
        <div className="right-col">
          {/**
            * 右栏 = P 索引条 + 审阅台（`DirectorPane`）—— **唯一的汇合产物**。
            * 审阅台自 P4 第二小步 b 起**整 P 铺开**，故传入的是整段取值表而不是单镜取值。
            * 原先与它上下堆叠的「H3 成品与质检」（`ResultPane`）已于 2026-10-06 按老大裁定整体移除：
            * 质检入口只留末端「全书清单」（`GatePanel`），生成结果直接在卡片的 14 格上读。
            */}
          <DirectorPane episode={episode} segment={segment} selectedShot={selectedShot} shotValues={shotValues} aiReady={aiReady} busy={busy} onRegenerate={(segmentId) => void regenerateSegment(segmentId)} segmentExportFormat={segmentExportFormat} onSegmentExportFormat={setSegmentExportFormat} onExportSegment={(segmentId, format) => void exportSegment(segmentId, format)} />
        </div>
      </main>
    </>}
    {message && <div role="status" className="toast"><button className="toast-close" aria-label="关闭提醒" title="关闭提醒" onClick={() => setMessage('')}>×</button><span>{message}</span></div>}
  </div>;
}
