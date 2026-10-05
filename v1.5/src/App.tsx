import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, ChevronDown, Download, FileInput, FilePlus2, ImagePlus, ListChecks, Loader2, PanelRight, Play, Save, Settings, Sparkles, Trash2 } from 'lucide-react';
import { sample } from './fixtures/sample';
import { activeEpisode, activeScript, projectSchema, type DefaultMode, type Episode, type ImageAnalysis, type Project, type ReferenceImage } from './core/model';
import { prepareImage } from './core/images';
import { samplePixels } from './core/pixels';
import { analyzeImage, analyzePixels, analyzeWithStats, buildLocalDescription, neutralPixelStats, type PixelStats, type Roster } from './core/analyze';
import { buildRoster, matchImages, subjectRoster } from './core/match';
import { splitEpisodes } from './core/episodes';
import { isMarkdownBrief } from './core/planner';
import { requestConnectionTest, requestCredentialsStatus, requestDescription, requestSaveCredentials, requestSegmentFields, type CredentialsStatus } from './core/vision';
import { reasoningLabels, reasoningLevels, type ReasoningLevel } from '../electron/ai-providers';
import { readWord, writeWord } from './core/word';
import { flushPersist, useWorkbench, type GenerationBatchEntry } from './store';
import { fields, generatedKeys, values, type EditableShotKey } from './platforms/minimax-h3/skeleton';
import { decodeScriptBytes, normalizeScriptText, sniffScriptPayload } from '../electron/text';
import { generateEpisodeDrafts, type ShotDraft } from './platforms/minimax-h3/director';
import { exportBundle, previewText } from './platforms/minimax-h3/compiler';
import { ignorableIssueCategories, issueCategoryNames, validate } from './platforms/minimax-h3/validator';
import { auditProject } from './platforms/minimax-h3/gate';
import { scheduleValidation, type ValidationState } from './core/asyncValidation';
import { allocateShotDurations, segmentDuration } from './core/timing';
import { SourcePane } from './panes/SourcePane';

const modeNames = { dialogue: '文戏', action: '武戏', combined: '综合' };
const typeNames = { 'short-drama': '短剧', 'mid-drama': '中剧', 'long-drama': '长剧', film: '电影' };
const confidenceNames = { high: '高', medium: '中', low: '低' } as const;

/**
 * 资产三类：**顺序与名称单一来源**，同时供「分区列表」与「导入目标」使用 ——
 * 两处各写一套的话，加一类资产时必有一处漏改。
 */
const assetKinds = ['character', 'scene', 'prop'] as const;
const assetKindNames: Record<ReferenceImage['kind'], string> = { character: '人物', scene: '场景', prop: '道具' };
const sourceNames = { local: '本地', ai: 'AI', manual: '人工' } as const;
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

/**
 * 参考图缩略图：**进入视口才挂 `src`**。
 *
 * 面板里它只显示 56×56，但浏览器会按**原图分辨率**完整解码。实测（2026-10-04）：
 * 给样例塞 12 张 1024×1024 噪声 PNG，DOM 就绪从 438ms 涨到 **3658ms**；
 * 而这段耗时既不计入 `longtask`、也几乎不落在「DOM 就绪」之后 ——
 * 它藏在提交帧里，所以「等元素出现」的旧口径两头都漏，这正是老大反馈的
 * 「打开后鼠标放在按键上三秒才有反应」。改成进视口才挂 `src` 后同一份存档降到 **604ms**。
 *
 * 注意：**这里刻意不用 object URL**。`index.html` 的 CSP 是 `img-src 'self' data:`，
 * 不含 `blob:`（`connect-src` 也不含 `data:`，`fetch(dataUrl)` 同样会被拦）。
 * 早前试过 `fetch` → `createObjectURL`，在被拦后静默回退成 data URL ——
 * 表面有收益、实际是空转，属本项目明令反对的「静默失败」，故移除。
 * 收益本来就来自「只解码要显示的那几张」，与 URL 形态无关。
 *
 * 空框由 CSS 定为 56×56，因此延后挂 `src` 不产生任何布局位移。
 */
function Thumb({ dataUrl, alt }: { dataUrl: string; alt: string }) {
  const node = useRef<HTMLImageElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = node.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  return <img ref={node} src={near ? dataUrl : undefined} alt={alt} loading="lazy" decoding="async" />;
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

/** AI 逐段「依次推理」时向前传递的上下文：上一段收尾的 ⑦光源 / ⑨站位 / ⑭衔接。 */
type PreviousContext = { light: string; blocking: string; transition: string };
/** 本集首段的初始上下文：无前序段落时为三空串。 */
const emptyContext: PreviousContext = { light: '', blocking: '', transition: '' };
/** AI 就绪参数：地址与模型必填，密钥可留空（由主进程回落本机私有配置）。 */
type AiTarget = { endpoint: string; apiKey: string; model: string; effort: ReasoningLevel };

/** 取某段草稿收尾镜的字段，作为下一段续接的上下文；该字段缺失时沿用上一段的值。 */
function contextAfter(drafts: ShotDraft[], previous: PreviousContext): PreviousContext {
  const last = drafts.at(-1);
  if (!last) return previous;
  const read = (key: 'light' | 'blocking' | 'transition', fallback: string) => {
    const value = last.fields[key];
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  };
  return { light: read('light', previous.light), blocking: read('blocking', previous.blocking), transition: read('transition', previous.transition) };
}

/**
 * AI 单段推理：把该段全部镜头一次性交给文本模型，返回可直接回填的草稿；失败则抛错，由调用方回退本地结果。
 * 约束：只产出 11 条可生成字段，时长由 `core/timing` 分配器决定（AI 不改秒数）。
 */
async function aiSegmentDrafts(
  project: Project, target: Episode, segment: Episode['segments'][number], ai: AiTarget, previous: PreviousContext,
): Promise<ShotDraft[]> {
  const images = segment.imageIds
    .map((id) => project.assets.find((image) => image.id === id))
    .filter((image): image is ReferenceImage => !!image && !!image.description.trim());
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
    },
  });
  const allocated = allocateShotDurations(segment.shots);
  const durationById = new Map(segment.shots.map((shot, index) => [shot.id, allocated[index]]));
  return shots.map((entry) => ({
    shotId: entry.shotId,
    source: 'ai' as const,
    duration: durationById.get(entry.shotId) ?? segmentDuration,
    fields: Object.fromEntries(generatedKeys.filter((key) => typeof entry.fields[key] === 'string' && entry.fields[key].trim()).map((key) => [key, entry.fields[key]])),
  }));
}

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
  const [tab, setTab] = useState<'result' | 'issues'>('issues');
  /** 分集核对清单默认折叠，且折叠态不渲染表格体（避免每次重渲染 diff 数十行）。 */
  const [splitOpen, setSplitOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
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
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, ImageAnalysis>>(new Map());
  const [matchNote, setMatchNote] = useState('');
  const [gateOpen, setGateOpen] = useState(false);
  const [ignoredGateIssues, setIgnoredGateIssues] = useState<Set<string>>(new Set());
  /**
   * 资产面板 = **单入口 + 分类小框**（2026-10-05 老大定稿）。
   * `activeAssetKind` 只决定**当前看哪一类**，不参与任何数据写入 —— 因此切分类只换视图，
   * 三个分类里的图片**互不干扰**（绑定 / 描述 / 确认都挂在图片自己身上）。
   */
  const [activeAssetKind, setActiveAssetKind] = useState<ReferenceImage['kind']>('character');
  const [kindMenuOpen, setKindMenuOpen] = useState(false);
  const kindMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!kindMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (kindMenuRef.current && !kindMenuRef.current.contains(event.target as Node)) setKindMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setKindMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [kindMenuOpen]);
  const [issues, setIssues] = useState<ReturnType<typeof validate>>([]);
  const [validationState, setValidationState] = useState<ValidationState>('idle');

  useEffect(() => { void hydrate(); }, [hydrate]);
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
  const shot = segment?.shots.find((item) => item.id === selectedShot) ?? segment?.shots[0];
  const shotValues = useMemo(() => (project && shot ? values(project, shot) : []), [project, shot]);
  const visibleIssues = issues.filter((issue) => !issue.segmentId || issue.segmentId === segment?.id);
  const source = project ? activeScript(project) : null;
  /** 整集文本按项目引用缓存，且只在「分镜预览」页签真正需要时计算。 */
  const preview = useMemo(() => (project && tab === 'result' ? previewText(project) : ''), [project, tab]);
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
  const gateIssueKey = (issue: { episodeId: string; code: string; segmentId?: string; shotId?: string; message: string }) => `${issue.episodeId}|${issue.code}|${issue.segmentId ?? ''}|${issue.shotId ?? ''}|${issue.message}`;
  const isIgnorableGateIssue = (issue: { category: keyof typeof issueCategoryNames }) => ignorableIssueCategories.includes(issue.category as typeof ignorableIssueCategories[number]);

  /**
   * 本集的匹配视图：资产库是全项目共用的，因此「本集用了什么、匹配得怎么样」一律以
   * **本集的匹配记账**（`episode.imageMatches`）与段绑定为准，不看别的集。
   */
  const boundIds = useMemo(() => new Set(episode?.segments.flatMap((item) => item.imageIds) ?? []), [episode]);
  const assets = project?.assets ?? [];
  const unassigned = useMemo(() => assets.filter((image) => !!episode?.imageMatches[image.id] && !boundIds.has(image.id)), [assets, episode, boundIds]);
  const lowConfidence = useMemo(() => assets.filter((image) => episode?.imageMatches[image.id]?.confidence === 'low'), [assets, episode]);

  const saveSettings = useCallback((next: { endpoint?: string; apiKey?: string; model?: string; effort?: ReasoningLevel; ai?: boolean }) => {
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
      setGateOpen(true); setTab('issues');
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
    } catch (error) { setGateOpen(true); setTab('issues'); setMessage(String(error)); }
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
    } catch (error) { setGateOpen(true); setTab('issues'); setMessage(`Word 导出失败：${String(error)}`); }
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
  /**
   * 导入目标分类：由**当前选中的分类**决定（`openImagePicker(activeAssetKind)`）。
   * 文件选择器只有一个、导入代码只有一条 —— 三类共用，不复制入口。
   */
  const pendingKind = useRef<ReferenceImage['kind']>('character');

  function openImagePicker(kind: ReferenceImage['kind']) {
    pendingKind.current = kind;
    imageInput.current?.click();
  }

  async function pickImages(files: FileList, kind: ReferenceImage['kind']) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    try {
      const prepared: ReferenceImage[] = [];
      let failed = 0;
      /**
       * 导入**只入库**（2026-10-05 老大裁定）：不再自动跑图像分析、不再自动写描述。
       * 理由：① 描述是要人核对后确认的产物，自动填成「文件名 + 主色」会让人以为已经完成；
       * ② 逐张解码采样是导入阶段的主要耗时，一次扔进几十张时体感明显。
       * 描述由「补齐本地描述 / 补齐 AI 描述」或单张卡上的按钮**人工触发**。
       */
      for (const file of list) {
        try { prepared.push(await prepareImage(file, kind)); } catch { failed += 1; }
      }
      const { added, duplicates } = store.addImages(prepared);
      setMessage(`已入库 ${added} 张到全本资产库（各集共用，不必逐集重复导入）${duplicates ? `，跳过重复 ${duplicates} 张` : ''}${failed ? `，失败 ${failed} 张` : ''}；描述待人工补齐：点「补齐本地描述」或「补齐 AI 描述」`);
    } finally { setBusy(false); }
  }
  async function describeOne(image: ReferenceImage) {
    if (!endpoint.trim() || !model.trim()) { setMessage('请先在接口设置中填写接口地址并选择模型'); return; }
    setBusy(true);
    try {
      const roster: Roster | undefined = episode ? subjectRoster(buildRoster(episode)) : undefined;
      // 密钥填了就用填的，留空由主进程回落本机私有配置。
      const result = await requestDescription({ endpoint: endpoint.trim() || undefined, apiKey: apiKey.trim() || undefined, effort, model: model.trim(), image, candidates: roster });
      store.updateImage(image.id, result.description);
      setMessage('图片描述已生成并生效（AI 增强，可随时改写）');
    } catch (error) { setMessage(`图片描述失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  async function describeLocalOne(image: ReferenceImage, overwrite = false) {
    if (image.description.trim() && !overwrite) { setMessage('已有描述，未覆盖；如需重做请先清空描述或使用批量覆盖'); return; }
    try {
      let analysis = image.analysis;
      if (!analysis) {
        const sampled = await samplePixels(image.dataUrl);
        const roster = episode ? subjectRoster(buildRoster(episode)) : { characters: [], scenes: [] };
        analysis = analyzeImage({ name: image.name, width: sampled.width, height: sampled.height, pixels: sampled.pixels }, roster);
      }
      // 分析结果随描述一并入库：色卡与图类理由只在补齐后出现，且下次打开仍在（导入阶段不做任何计算）。
      store.updateImage(image.id, buildLocalDescription({ name: image.name, analysis }), analysis);
      setMessage('本地描述已生成并生效（可随时改写）');
    } catch (error) { setMessage(`本地描述失败：${String(error)}`); }
  }

  async function describeLocalMissing() {
    if (!project || busy) return;
    setBusy(true);
    try {
      const targets = project.assets.filter((image) => !image.description.trim());
      for (const image of targets) await describeLocalOne(image, true);
      setMessage(targets.length ? `已为 ${targets.length} 张未描述资产生成本地描述，已生效` : '没有空白描述的资产');
    } finally { setBusy(false); }
  }

  /**
   * 补齐 AI 描述：**人工触发**，只处理描述为空的资产。
   * 单张失败不中断整批（网络分批失败是常态），末尾统一汇报成功数，未成功的仍是空描述、可重试。
   */
  async function describeAiMissing() {
    if (!project || busy) return;
    if (!endpoint.trim() || !model.trim()) { setMessage('请先在「接口设置」中填写接口地址并选择模型，再补齐 AI 描述'); return; }
    const targets = project.assets.filter((image) => !image.description.trim());
    if (!targets.length) { setMessage('没有空白描述的资产（如需重做请先清空描述）'); return; }
    setBusy(true);
    try {
      const roster: Roster | undefined = episode ? subjectRoster(buildRoster(episode)) : undefined;
      let done = 0;
      for (const [index, image] of targets.entries()) {
        setProgress({ running: true, label: `AI 描述 ${index + 1}/${targets.length}`, value: (index + 1) / targets.length });
        try {
          const result = await requestDescription({ endpoint: endpoint.trim() || undefined, apiKey: apiKey.trim() || undefined, effort, model: model.trim(), image, candidates: roster });
          store.updateImage(image.id, result.description);
          done += 1;
        } catch { /* 单张失败继续下一张 */ }
      }
      setMessage(done === targets.length ? `已为 ${done} 张资产生成 AI 描述，已生效（可逐张改写）` : `AI 描述完成 ${done}/${targets.length} 张，其余失败；可再点一次重试（已生成的不会被覆盖）`);
    } finally { setProgress(null); setBusy(false); }
  }

  function clearAllImageDescriptions() {
    if (!project) return;
    const described = project.assets.filter((image) => image.description.trim());
    for (const image of described) store.updateImage(image.id, '');
    setMessage(described.length ? `已清空 ${described.length} 张资产的描述` : '资产库当前没有描述内容');
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
        let aiFilled = 0; let aiSegments = 0; let fallback = 0;
        let previous = emptyContext;
        for (const [index, item] of target.segments.entries()) {
          await checkpoint();
          setProgress({ running: true, label: `AI 依次推理 ${index + 1}/${target.segments.length}（${item.id}）`, value: 0.55 + (index / Math.max(1, target.segments.length)) * 0.4 });
          try {
            const base = localFor(item.id);
            const purposeById = new Map(base.map((draft) => [draft.shotId, draft.purpose]));
            const drafts = await aiSegmentDrafts(project, target, item, ai, previous);
            // 导演意图由本地规则派生（AI 不产出 purpose），与 AI 字段合并后一次写入。
            aiFilled += store.applyGenerated(item.id, drafts.map((draft) => ({ ...draft, purpose: purposeById.get(draft.shotId) })), { overwrite, source: 'ai' });
            previous = contextAfter(drafts, previous);
            aiSegments += 1;
          } catch {
            const list = localFor(item.id);
            if (list.length) store.applyGenerated(item.id, list, { overwrite, source: 'local' });
            fallback += 1;
          }
        }
        setMessage(fallback
          ? `AI 依次推理完成 ${aiSegments} 段（${aiFilled} 条字段），${fallback} 段未通过已回退本地规则结果`
          : `AI 依次推理完成 ${aiSegments} 段，生成 ${aiFilled} 条字段，校验通过`);
      } else {
        setProgress({ running: true, label: '规则导演自动生成意图与正文', value: 0.7 });
        await checkpoint();
        const drafts = generateEpisodeDrafts(project, target, local);
        let filled = 0;
        for (const [segmentId, list] of drafts) filled += store.applyGenerated(segmentId, list, { overwrite, source: 'local' });
        setMessage(`本地规则导演已填充 ${filled} 条字段，并标记 ${drafts.size} 段导演决策已生成${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);
      }
    } catch (error) {
      if (error === jobStopped) setMessage('已终止；已完成的部分保留在导演板上');
      else setMessage(`一键生成失败：${String(error)}`);
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
    let processed = 0; let written = 0; let filled = 0; let segmentsWritten = 0;
    const flush = () => {
      if (!pending.length) return;
      written += pending.length;
      const result = store.applyGenerationBatch(pending.splice(0), { overwrite, source: 'local' });
      filled += result.filled; segmentsWritten += result.segments;
    };
    try {
      const ai = aiTarget();
      const analysisByEpisode = new Map<string, Map<string, ImageAnalysis>>();
      let failed = 0; let aiSegments = 0; let fallbackSegments = 0;
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
                const aiDrafts = await aiSegmentDrafts(book, item, segment, ai, previous);
                drafts.push({ segmentId: segment.id, drafts: aiDrafts.map((draft) => ({ ...draft, purpose: purposeById.get(draft.shotId) })) });
                previous = contextAfter(aiDrafts, previous);
                aiSegments += 1;
              } catch {
                if (base.length) drafts.push({ segmentId: segment.id, drafts: base });
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
        } catch { failed += 1; }
      }
      await checkpoint();
      setProgress({ running: true, label: '写入剩余分集并标记已生成', value: 0.95 });
      flush();
      setAnalyses(analysisByEpisode.get(activeEpisode(book).id) ?? new Map());
      setMatchNote(`选集生成完成：处理 ${processed}/${total} 集，填充 ${filled} 条字段，${segmentsWritten} 段导演决策已生成${failed ? `，${failed} 集失败已隔离` : ''}`);
      setMessage(ai
        ? `选集生成完成：${processed}/${total} 集，AI 依次推理 ${aiSegments} 段${fallbackSegments ? `，${fallbackSegments} 段回退本地` : ''}${failed ? `，${failed} 集失败已隔离` : ''}`
        : `选集生成完成：${processed}/${total} 集逐集分析并回填，${segmentsWritten} 段已标记导演决策已生成${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);
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

  /**
   * 接口设置面板：**没有厂商下拉**（由地址自动识别）。
   * 密钥可在界面手填（只存内存、不落盘），留空时由主进程用本机私有配置补齐。
   */
  const settingsPanel = settingsOpen && <div className="settings-panel" role="dialog" aria-label="接口设置">
    <div className="settings-head"><h3>接口设置（可选增强）</h3><button onClick={() => setSettingsOpen(false)}>关闭</button></div>
    <p className="settings-note">默认关闭 AI 增强，不接接口也能完成本地识别、拆分与生成。地址只需填到 /v1 一级，厂商由地址自动识别、无需选择；密钥填入即自动常驻本机、无需手动保存，留空时用本机已存的那把，清空即从本机撤销（该文件不进仓库、不进构建产物）。</p>
    <label className="ai-switch"><input type="checkbox" aria-label="启用AI增强" checked={aiEnabled} onChange={(event) => saveSettings({ ai: event.target.checked })} />启用 AI 增强（接入后一键生成以 AI 依次推理为主，本地作兜底）</label>
    <p className={`settings-note route-note${aiReady ? ' ai-ready' : ''}`} role="status" aria-label="生成主路径">当前生成主路径：<strong>{aiReady ? 'AI 逐段依次推理（某段未通过时回退本地规则）' : '本地规则引擎'}</strong>。开启并接入 AI 后，一键生成按钮会显示为「AI 依次推理」，选集生成同样改走逐段依次推理。</p>
    <label>url（接口地址）<input aria-label="接口地址" value={endpoint} onChange={(event) => saveSettings({ endpoint: event.target.value })} placeholder="https://…/v1" /></label>
    <label>key（密钥）<input type="password" aria-label="密钥" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => saveSettings({ apiKey: event.target.value })} placeholder={localCredentials?.configured ? '••••••••••（本机已保存，留空即用它）' : '填入后自动常驻本机，无需手动保存'} /></label>
    {/*
      模型项在 url 与 key 就绪前不渲染 —— 还没法接入时先摆一个模型名只会造成误解。
      「就绪」= 地址非空 且（手填了密钥 或 本机已配置密钥）。
    */}
    {endpoint.trim() !== '' && (apiKey.trim() !== '' || localCredentials?.configured === true) && <label>模型{modelOptions.length
      ? <select aria-label="模型" value={model} onChange={(event) => saveSettings({ model: event.target.value })}>{modelOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      : <input aria-label="模型" value={model} onChange={(event) => saveSettings({ model: event.target.value })} placeholder="接入后自动列出，也可手填" />}</label>}
    <label>思考强度<select aria-label="思考强度" value={effort} onChange={(event) => saveSettings({ effort: event.target.value as ReasoningLevel })}>{reasoningLevels.map((level) => <option key={level} value={level}>{reasoningLabels[level]}</option>)}</select></label>
    <div className="settings-actions"><button onClick={testConnection}>接入并拉取模型</button>{connection && <span className={connection.ok ? 'ok' : 'fail'}>{connection.message}</span>}</div>
    <p className="settings-note" role="status" aria-label="本机密钥状态">本机密钥：{localCredentials === null
      ? '正在检查本机配置…'
      : localCredentials.configured
        ? '已存本机，输入框留空即用它；改填自动覆盖，清空即撤销。'
        : '未存本机，填入后自动写入，无需手动保存。'}{keyNote ? ` ${keyNote}` : ''}</p>
  </div>;

  /**
   * 选择集生成浮层：勾选集后开跑。默认只勾当前集（补跑一集是高频诉求），要整本就点「全选」。
   * 「生成」按钮带集数，避免误触整本重跑。
   */
  const episodePicker = pickerOpen && project && <div className="gate-backdrop" onClick={() => setPickerOpen(false)}>
    <div className="gate-panel picker-panel" role="dialog" aria-label="选择要生成的分集" onClick={(event) => event.stopPropagation()}>
      <div className="gate-head">
        <div><h3>选择要生成的分集</h3><p className="settings-note">只处理勾选的集，逐集做图像分析 → 匹配 → 生成，单集失败隔离不阻断其余集。{aiReady ? 'AI 就绪，将逐段依次推理，单段失败回退本地规则。' : '当前为本地规则引擎。'}</p></div>
        <button onClick={() => setPickerOpen(false)}>取消</button>
      </div>
      <div className="picker-tools">
        <button onClick={() => setPickedEpisodes(project.episodes.map((item) => item.id))}>全选</button>
        <button onClick={() => setPickedEpisodes([])} disabled={!pickedEpisodes.length}>全不选</button>
        <button onClick={() => setPickedEpisodes([activeEpisode(project).id])}>只选当前集</button>
        <span className="picker-count">已选 {pickedEpisodes.length}/{project.episodes.length} 集</span>
      </div>
      <div className="gate-scroll"><div className="picker-list">{project.episodes.map((item) => <label key={item.id} className={pickedEpisodes.includes(item.id) ? 'picked' : undefined}>
        <input type="checkbox" aria-label={`分集 ${item.label}`} checked={pickedEpisodes.includes(item.id)} onChange={(event) => togglePicked(item.id, event.target.checked)} />
        <span>{item.label}</span><small>{item.segments.length} 段</small>
      </label>)}</div></div>
      <div className="gate-actions">
        <button onClick={() => setPickedEpisodes(project.episodes.map((item) => item.id))}>全选并生成</button>
        <button className="primary" disabled={!pickedEpisodes.length || busy} onClick={() => { const ids = [...pickedEpisodes]; setPickerOpen(false); void generateEpisodes(ids); }}>生成选中的 {pickedEpisodes.length} 集</button>
      </div>
    </div>
  </div>;

  /** 全书阻断清单：逐条给出集/段/镜与分类，可直接跳转定位；可导出集单列并支持按集导出。 */
  const gatePanel = gateOpen && project && gate && <div className="gate-backdrop" onClick={() => setGateOpen(false)}>
    <div className="gate-panel" role="dialog" aria-label="全书阻断清单" onClick={(event) => event.stopPropagation()}>
      <div className="gate-head"><div><h3>全书阻断清单</h3><p className="settings-note">阻断项只含事实类问题与内容安全项；可忽略仅在本次清单会话中折叠输入和参考图问题。</p></div><button onClick={() => setGateOpen(false)}>关闭</button></div>
      <div className="gate-summary">
        <span className={gate.errors.length ? 'error-count' : 'ready-count'}>{gate.errors.length ? `${gate.errors.length - gate.errors.filter((issue) => ignoredGateIssues.has(gateIssueKey(issue))).length} 项未忽略阻断 · ${gate.episodes.filter((item) => item.errors.some((issue) => !ignoredGateIssues.has(gateIssueKey(issue)))).length} 集待处理` : '全书没有阻断项'}</span>
        <span>可导出集 {gate.exportableEpisodes.length}/{gate.episodes.length} · 建议复核 {gate.warnings.length} 项</span>
      </div>
      <div className="gate-scroll"><div className="gate-list">{gate.episodes.filter((item) => item.errors.some((issue) => !ignoredGateIssues.has(gateIssueKey(issue)))).map((item) => <div className="gate-episode" key={item.episodeId}>
        <div className="gate-episode-head"><strong>{item.label}</strong><span>{item.errors.filter((issue) => !ignoredGateIssues.has(gateIssueKey(issue))).length} 项未忽略阻断</span></div>
        {item.errors.filter((issue) => !ignoredGateIssues.has(gateIssueKey(issue))).map((issue, index) => <div className="gate-item" key={`${issue.code}-${issue.segmentId ?? 'ep'}-${issue.shotId ?? index}-${index}`}>
          <span className={`gate-tag ${issue.category}`}>{issueCategoryNames[issue.category]}</span>
          <span className="gate-where">{issue.segmentId ?? '本集'}{issue.shotId ? ` · ${issue.shotId}` : ''}</span>
          <span className="gate-message">{issue.message}</span>
          <button onClick={() => { store.focusTarget(item.episodeId, issue.segmentId, issue.shotId); setTab('issues'); setGateOpen(false); }}>跳转</button>
          {isIgnorableGateIssue(issue) && <button onClick={() => setIgnoredGateIssues((old) => new Set(old).add(gateIssueKey(issue)))}>忽略</button>}
        </div>)}
      </div>)}</div></div>
      {gate.errors.length > 0 && <div className="gate-actions"><button className="primary" onClick={() => repairBlocked()} title="按原始剧本重建结构与台词，并保留可匹配的导演内容">自动修复全部阻断</button><button onClick={() => repairBlocked(activeEpisode(project).id)} title="只修复当前集">修复本集</button>{gate.errors.some((issue) => isIgnorableGateIssue(issue) && !ignoredGateIssues.has(gateIssueKey(issue))) && <button onClick={() => setIgnoredGateIssues((old) => new Set([...old, ...gate.errors.filter(isIgnorableGateIssue).map(gateIssueKey)]))}>忽略可忽略阻断</button>}<button onClick={() => setIgnoredGateIssues(new Set())} disabled={!ignoredGateIssues.size}>恢复已忽略</button></div>}
      {gate.exportableEpisodes.length > 0 && <div className="gate-clean">
        <strong>可直接导出的集（{gate.exportableEpisodes.length}）</strong>
        <p className="settings-note">其他集存在阻断不影响这些集；单集导出不改变当前选中的集。</p>
        <div className="gate-clean-list">{gate.exportableEpisodes.map((item) => <span className="gate-clean-item" key={item.episodeId}>{item.label}<button onClick={() => void exportFile(item.episodeId)}>导出 TXT</button><button onClick={() => void exportWord(item.episodeId)}>导出 Word</button></span>)}</div>
      </div>}
    </div>
  </div>;

  /**
   * 资产卡片（三类共用同一张卡）。面板一次只渲染**当前选中的分类**，卡片本身与分类无关。
   * 匹配置信度取**本集**的匹配记账，不看别的集。
   */
  function renderAsset(image: ReferenceImage) {
    // 空项目时列表不渲染，这里仍按可选链取值：卡片是独立闭包，拿不到 JSX 里的非空收窄。
    const match = episode?.imageMatches[image.id];
    /**
     * 图类提示：`kindGuess` 是**按文件名猜的**，只作提示、**不参与匹配**（匹配按用户导入时所选分类，
     * 见 `match.ts`）。两者不一致时必须说清楚，否则卡片会自相矛盾 —— 图摆在「人物」区，
     * 副标题却写着「文件名关键词判为道具」，用户不知道自己该信哪个。
     */
    const kindHint = image.analysis
      ? (image.analysis.kindGuess === image.kind ? image.analysis.kindReason : `文件名疑似${assetKindNames[image.analysis.kindGuess]} · 仅提示，匹配按所选分类`)
      : '';
    return <div className={`image-item ${match?.confidence === 'medium' ? 'review' : ''}`} key={image.id}>
      <button className="image-remove" aria-label={`删除${image.name}`} title="从资产库删除这张图（不可撤销）" onClick={() => removeAsset(image)}>×</button>
      <Thumb dataUrl={image.dataUrl} alt={image.name} />
      <div className="image-detail">
        <strong>{image.name}</strong>
        <small>{assetKindNames[image.kind]} · SHA-256 {image.sha256.slice(0, 10)} · v{image.version}{match ? ` · ${confidenceNames[match.confidence]}置信度` : ''}{kindHint ? ` · ${kindHint}` : ''}</small>
        {image.analysis?.dominant.length ? <div className="palette" aria-label={`${image.name}色卡`}>{image.analysis.dominant.map((color) => <span key={color} title={color} aria-label={color} style={{ backgroundColor: color }} />)}</div> : null}
        <label className="image-use"><input type="checkbox" checked={!!segment?.imageIds.includes(image.id)} disabled={!segment || (!!segment && !segment.imageIds.includes(image.id) && segment.imageIds.length >= 6)} onChange={() => { if (segment && !store.toggleImage(segment.id, image.id)) setMessage('本段已绑定 6 张参考图（上限），该图保留在库中标记为已入库未绑定'); }} />用于本段</label>
        <textarea aria-label={`${image.name}描述`} value={image.description} onChange={(event) => store.updateImage(image.id, event.target.value)} placeholder="描述即生效：可点「本地生成描述」/「AI 生成描述」，也可直接人工填写（导入不会自动生成）" />
        <div className="image-actions"><button onClick={() => void describeLocalOne(image)} disabled={busy}>本地生成描述</button><button onClick={() => void describeOne(image)} disabled={busy}>AI 生成描述</button></div>
        {!image.description.trim() && <p className="image-note" role="status">未写描述：这张图不会进入 ①②④（三类资产一致，填了即生效，无需确认）</p>}
      </div>
    </div>;
  }

  /**
   * 删除单张资产。资产是项目级单源，删一次即**全本解除绑定** ——
   * 因此只要它被任何集绑定、或已有描述（即存在用户劳动），就先确认并把影响范围说清楚；
   * 纯空白、无人引用的图直接删（不值得为一次误点弹窗）。
   */
  function removeAsset(image: ReferenceImage) {
    const usedBy = (project?.episodes ?? []).filter((item) => item.segments.some((segment) => segment.imageIds.includes(image.id)));
    if (usedBy.length || image.description.trim()) {
      const detail = usedBy.length
        ? `已被 ${usedBy.length} 集绑定：${usedBy.map((item) => item.label).join('、')}；删除后这些段的绑定一并解除`
        : '该资产已有描述';
      if (!window.confirm(`删除资产「${image.name}」？\n${detail}。\n删除不可撤销（重新导入同一张图即可恢复）。`)) return;
    }
    store.removeImage(image.id);
    setMessage(`已删除资产「${image.name}」，全本绑定一并解除`);
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">分</span><div><strong>剧本拆分工作台</strong><small>MINIMAX H3 / 分镜正本</small></div></div>
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
    {settingsPanel}
    {gatePanel}
    {episodePicker}
    {storageError && <div className="save-warning" role="alert">本地存档读取失败：磁盘上仍有这份存档（未被覆盖），但当前版本读不出来，所以工作台显示为空。请先「保存项目」或手工备份原存档，再开始新的编辑 —— 直接编辑并自动保存会覆盖掉它。</div>}
    {!storageReady ? <main className="empty-workspace" aria-busy="true"><div className="empty-icon"><Loader2 size={32} className="spin" /></div><h1>正在载入本地存档…</h1><p>{slowLoad ? '这份存档较大，正在装回参考图并重建分集，请稍候（请勿关闭窗口）。' : '正在读取本地存档。'}</p></main> : !project ? <main className="empty-workspace"><div className="empty-icon"><PanelRight size={32} /></div><h1>从原剧本开始</h1><p>导入整本剧本与批量参考图片，一键生成本地识别的 14 条分镜；AI 增强为可选项。</p><div className="empty-actions"><button className="primary" onClick={openFile}><FileInput size={17} />导入剧本</button><button onClick={() => { store.importScript(sample, '验收样例'); }}><Play size={17} />打开样例</button><button onClick={() => setSettingsOpen(true)}><Settings size={17} />接口设置</button></div></main> : episode && <>
      <div className="episode-bar">
        <div className="episode-list">{project.episodes.map((item) => <button key={item.id} className={item.id === episode.id ? 'active' : ''} onClick={() => store.selectEpisode(item.id)} title={item.label}>{item.label}<small>{item.segments.length} 段</small></button>)}</div>
        <div className="episode-note"><span className="episode-note-text">{project.episodes.length > 1 ? `已自动识别 ${project.episodes.length} 集` : '未识别到集标，已按整本单集处理；展开下方清单核对切点'}</span>{!episode.splitVerified && <button onClick={() => store.verifySplit()}>核对分集</button>}</div>
      </div>
      <details className="split-list" open={splitOpen} onToggle={(event) => setSplitOpen(event.currentTarget.open)}><summary>分集核对清单（集号 / 标题 / 字数 / 场次 / 切点行号）</summary>{splitOpen && <table><thead><tr><th>集号</th><th>标题</th><th>字数</th><th>场次</th><th>切点行号</th></tr></thead><tbody>
        {project.episodes.map((item, index) => <tr key={item.id} className={item.id === episode.id ? 'active' : ''}><td>{item.label}</td><td>{split?.episodes[index]?.title || '—'}</td><td>{split?.episodes[index]?.charCount ?? 0}</td><td>{item.scenes.length}</td><td>{split ? `${split.episodes[index]?.startLine}–${split.episodes[index]?.endLine}` : '—'}</td></tr>)}
      </tbody></table>}</details>
      <div className="projectbar"><div><input aria-label="作品名称" value={project.title} onChange={(event) => store.setProject({ ...project, title: event.target.value || '未命名作品' }, false)} /><span className="episode">{episode.label}</span><span className="tag">{typeNames[project.contentType]}</span></div><div className="project-controls"><span className={`validation-status ${validationState}`}>{validationState === 'validating' ? '正在校验…' : validationState === 'ready' ? '校验完成' : ''}</span><label>整集规划模式 <select aria-label="整集规划模式" value={project.defaultMode} onChange={(event) => store.setMode(event.target.value as DefaultMode)}>{Object.entries(modeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>内容类型 <select aria-label="内容类型" value={project.contentType} onChange={(event) => store.setProject({ ...project, contentType: event.target.value as typeof project.contentType }, false)}>{Object.entries(typeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="overwrite"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />覆盖已有内容</label><button onClick={() => { if (window.confirm('重新规划将替换所有未另存的导演板编辑。继续？')) store.replan(); }} title="按当前原稿和模式重新拆段">重新规划</button></div></div>
    {autosaveError && <div className="save-warning" role="alert">本地存档写入失败，当前改动未自动保存。请立即“保存项目”留存 JSON 快照。</div>}
    {splitStatus === 'rebuilt' && <div className="save-warning" role="status">这份存档的分集由 <strong>旧版识别口径</strong> 生成，已按当前版本自动重建为 {project.episodes.length} 集。若切点不符，请展开「分集核对清单」核对，或点「重新规划」重来。</div>}
    {splitStatus === 'stale' && <div className="save-warning" role="alert">这份存档的分集由 <strong>旧版识别口径</strong> 生成；检测到已有导演板编辑 / 参考图 / 生成内容，<strong>未自动重建</strong>（避免覆盖你的工作）。请展开「分集核对清单」确认；确认可重建后点右上角「重新规划」（参考图会保留，导演板字段会重算）。</div>}
    {migrated && <div className="save-warning" role="status">已从 v1.0 单集存档自动迁移到 v1.1 多集结构（1 集），旧数据未丢失。</div>}
      {progressPanel}
      <main className="workspace">
        <SourcePane projectId={project.id} sceneCount={episode.scenes.length} beatCount={episode.beats.length} filename={source?.filename ?? ''} scriptId={project.activeScriptId} sourceText={sourceText} onMessage={onMessage} />
        <section className="pane input-image-pane" aria-label="输入图片"><div className="pane-title"><h2>输入图片</h2><span>{project.assets.length} 张已入库 · 全本共用 · 本段 {segment?.imageIds.length ?? 0}/6</span></div><div className="image-settings">
          <input ref={imageInput} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="选择参考图片" onChange={(event) => { if (event.target.files?.length) void pickImages(event.target.files, pendingKind.current); event.target.value = ''; }} />
          <div className="image-add"><button onClick={() => void describeLocalMissing()} disabled={busy || !project.assets.length} title="只为描述为空的资产生成本地描述（文件名 + 主色卡，零 API）">补齐本地描述</button><button onClick={() => void describeAiMissing()} disabled={busy || !project.assets.length} title="只为描述为空的资产调用视觉模型生成描述（需先在接口设置中配置地址与模型）">补齐 AI 描述</button><button onClick={clearAllImageDescriptions} disabled={!project.assets.some((image) => image.description.trim())} title="清空全部资产描述，保留图片和分析数据">清空描述</button></div>
          {matchNote && <p className="match-note">{matchNote}</p>}
          {(lowConfidence.length > 0 || unassigned.length > 0) && <div className="unassigned-zone"><strong>未分配区</strong>{unassigned.map((image) => <span key={image.id} className={`chip ${episode.imageMatches[image.id]?.confidence ?? 'low'}`}>{image.name}<em>{confidenceNames[episode.imageMatches[image.id]?.confidence ?? 'low']}置信度</em></span>)}{!unassigned.length && lowConfidence.map((image) => <span key={image.id} className="chip low">{image.name}<em>低置信度</em></span>)}</div>}
          {(() => {
            /**
             * 单入口 + 分类小框（2026-10-05 老大定稿）：点标题弹出「道具 / 人物 / 场景」三个选项，
             * 选中哪一类就只渲染哪一类 —— 三类资产不混排，各自的图片**互不干扰**。
             * 导入目标同样跟随当前分类（不再有三组各自的导入按钮）。
             */
            const kindCount = (kind: ReferenceImage['kind']) => assets.filter((image) => image.kind === kind).length;
            const items = assets.filter((image) => image.kind === activeAssetKind);
            const described = items.filter((image) => !!image.description.trim()).length;
            return <section className="asset-group" aria-label={`${assetKindNames[activeAssetKind]}资产`}>
              <div className="asset-group-head" ref={kindMenuRef}>
                <button className="asset-kind-trigger" aria-label="切换资产分类" aria-haspopup="menu" aria-expanded={kindMenuOpen} onClick={() => setKindMenuOpen((open) => !open)} title="切换查看的资产分类"><strong>{assetKindNames[activeAssetKind]}</strong><span>{items.length} 张{described ? ` · 有描述 ${described}` : ''}</span><ChevronDown size={14} className={kindMenuOpen ? 'flip' : ''} /></button>
                <button aria-label={`导入${assetKindNames[activeAssetKind]}`} onClick={() => openImagePicker(activeAssetKind)} disabled={busy} title={`导入到${assetKindNames[activeAssetKind]}（不设数量上限）`}><ImagePlus size={14} />导入</button>
                {kindMenuOpen && <div className="asset-kind-menu" role="menu" aria-label="资产分类">
                  {assetKinds.map((kind) => <button key={kind} role="menuitemradio" aria-checked={kind === activeAssetKind} aria-label={`切换到${assetKindNames[kind]}`} className={kind === activeAssetKind ? 'active' : ''} onClick={() => { setActiveAssetKind(kind); setKindMenuOpen(false); }}><span>{assetKindNames[kind]}</span><em>{kindCount(kind)} 张</em></button>)}
                </div>}
              </div>
              {items.map((image) => renderAsset(image))}
              {!items.length && <p className="asset-group-empty">暂无{assetKindNames[activeAssetKind]}资产</p>}
            </section>;
          })()}
        </div></section>
        <section className="pane director-pane"><div className="pane-title"><h2>导演板</h2><span>{episode.segments.length} 段 · 文{episode.segments.filter((item) => item.mode === 'dialogue').length} / 武{episode.segments.filter((item) => item.mode === 'action').length} · 已生成 {episode.segments.filter((item) => item.directorGenerated).length}/{episode.segments.length}</span></div><div className="segment-strip">{episode.segments.map((item) => <button key={item.id} className={item.id === segment?.id ? 'selected' : ''} onClick={() => store.selectSegment(item.id)}><strong>{item.id}</strong><small>{modeNames[item.mode]} · 15s</small>{item.directorGenerated && <em className="gen-tag">已生成</em>}{!item.confirmed && <span className="dot" />}</button>)}</div><div className="mode-note">综合模式按剧情节拍逐段选文/武，不固定段数配比。</div>
          <div className="visual-settings"><div className="section-heading"><h3>视觉文字设定 <span>v{project.visual.version}</span></h3><button onClick={() => store.confirmVisual()} disabled={project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim()}><Check size={15} />{project.visual.confirmed ? '已确认' : '确认设定'}</button></div><label>人物固定锚点<textarea aria-label="人物固定锚点" value={project.visual.character} onChange={(event) => store.updateVisual('character', event.target.value)} placeholder="面部特征、发型、服装；缺图时使用人工确认的文字设定" /></label><label>场景固定锚点<textarea aria-label="场景固定锚点" value={project.visual.scene} onChange={(event) => store.updateVisual('scene', event.target.value)} placeholder="门窗、家具、光源及轴线方位" /></label></div>
          {segment && <div className="segment-editor"><div className="section-heading"><h3>{segment.id} <span>{episode.scenes.find((item) => item.id === segment.sceneId)?.title}</span></h3><select aria-label="本段模式" value={segment.mode} onChange={(event) => store.setSegmentMode(segment.id, event.target.value as 'dialogue' | 'action')}><option value="dialogue">文戏</option><option value="action">武戏</option></select></div><div className="beat-summary">{segment.beatIds.map((id) => episode.beats.find((beat) => beat.id === id)?.text).join(' / ')}</div><div className="shot-tabs">{segment.shots.map((item) => <button key={item.id} className={item.id === shot?.id ? 'active' : ''} onClick={() => store.selectShot(item.id)}>{item.id}<small>{item.duration}s</small></button>)}</div>
            {shot && <div className="shot-editor"><div className="shot-heading"><label>导演意图（自动生成）<textarea aria-label="导演意图" value={shot.purpose || '点击一键生成或选择集生成后自动生成'} readOnly /></label><label className="duration">时长 <input aria-label="镜头时长" type="number" value={shot.duration} readOnly aria-readonly="true" />s（本段各镜合计 {segmentDuration} 秒）</label>{shot.draftSource && <span className={`source-tag ${shot.draftSource}`}>来源：{sourceNames[shot.draftSource]}</span>}</div><div className="field-grid">{fields.map(({ key, label }, i) => <label key={key}><span>{String.fromCharCode(0x2460 + i)} {label}</span>{key === 'character' || key === 'scene' || key === 'dialogue' ? <div className="readonly-field">{shotValues[i] || '未提供（填了描述即自动写入）'}</div> : <textarea aria-label={label} value={shot[key]} onChange={(event) => store.updateShot(shot.id, key as EditableShotKey, event.target.value)} placeholder="待导演确认" />}</label>)}</div></div>}
          </div>}
        </section>
        <section className="pane result-pane"><div className="pane-title"><h2>H3 成品与质检</h2><span className={errors.length ? 'error-count' : 'ready-count'}>{errors.length ? `${errors.length} 项阻断` : '本集可导出'}</span></div><div className="result-tabs"><button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>本段问题 <span>{visibleIssues.length}</span></button><button className={tab === 'result' ? 'active' : ''} onClick={() => setTab('result')}>分镜预览</button></div>{tab === 'issues' ? <div className="issues">{visibleIssues.map((issue, index) => <div className={`issue ${issue.severity}`} key={index}><AlertCircle size={15} /><div><span className={`issue-badge ${issue.severity}`}>{issue.severity === 'error' ? '阻断' : '复核'}</span><strong>{issue.segmentId} {issue.shotId}</strong><p>{issue.message}</p></div></div>)}{!visibleIssues.length && <p>本段没有发现问题。</p>}<p className="issues-note">其他集与本段以外的阻断项，在「全书清单」中逐条列出并可跳转定位。</p></div> : <pre className="preview">{preview}</pre>}<div className="result-footer"><span>来源与版本信息仅保留在项目快照中。</span><button onClick={() => setGateOpen(true)}>全书清单{errors.length ? `（本集 ${errors.length} 项阻断）` : ''}</button></div></section>
      </main>
    </>}
    {message && <div role="status" className="toast"><button className="toast-close" aria-label="关闭提醒" title="关闭提醒" onClick={() => setMessage('')}>×</button><span>{message}</span></div>}
  </div>;
}
