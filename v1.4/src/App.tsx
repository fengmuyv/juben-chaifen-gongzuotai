import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Download, FileInput, FilePlus2, ImagePlus, Layers, PanelRight, Play, Save, Settings, Sparkles, Trash2 } from 'lucide-react';
import { sample } from './fixtures/sample';
import { activeEpisode, activeScript, projectSchema, type DefaultMode, type Episode, type ImageAnalysis, type ReferenceImage } from './core/model';
import { prepareImage } from './core/images';
import { samplePixels } from './core/pixels';
import { analyzeImage, buildLocalDescription, type Roster } from './core/analyze';
import { buildRoster, matchImages, subjectRoster } from './core/match';
import { splitEpisodes } from './core/episodes';
import { isMarkdownBrief } from './core/planner';
import { requestConnectionTest, requestDescription, requestSegmentFields } from './core/vision';
import { readWord, writeWord } from './core/word';
import { flushPersist, useWorkbench, type GenerationBatchEntry } from './store';
import { fields, generatedKeys, values, type EditableShotKey } from './platforms/minimax-h3/skeleton';
import { decodeScriptBytes, normalizeScriptText, sniffScriptPayload } from '../electron/text';
import { generateEpisodeDrafts } from './platforms/minimax-h3/director';
import { exportBundle, previewText } from './platforms/minimax-h3/compiler';
import { ignorableIssueCategories, issueCategoryNames, shotDuration, validate } from './platforms/minimax-h3/validator';
import { auditProject } from './platforms/minimax-h3/gate';
import { scheduleValidation, type ValidationState } from './core/asyncValidation';
import { SourcePane } from './panes/SourcePane';

const modeNames = { dialogue: '文戏', action: '武戏', combined: '综合' };
const typeNames = { 'short-drama': '短剧', 'mid-drama': '中剧', 'long-drama': '长剧', film: '电影' };
const confidenceNames = { high: '高', medium: '中', low: '低' } as const;
const sourceNames = { local: '本地', ai: 'AI', manual: '人工' } as const;
const endpointKey = 'script-storyboard-workbench-endpoint';
const modelKey = 'script-storyboard-workbench-model';
const aiKey = 'script-storyboard-workbench-ai';

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
  const store = useWorkbench.getState();
  /** hydrate 的引用在 store 中始终稳定，可安全作为依赖，不会随每次状态变更重跑。 */
  const hydrate = useWorkbench((state) => state.hydrate);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'result' | 'issues'>('issues');
  /** 分集核对清单默认折叠，且折叠态不渲染表格体（避免每次重渲染 diff 数十行）。 */
  const [splitOpen, setSplitOpen] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageKind, setImageKind] = useState<ReferenceImage['kind']>('character');
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connection, setConnection] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analyses, setAnalyses] = useState<Map<string, ImageAnalysis>>(new Map());
  const [matchNote, setMatchNote] = useState('');
  const [gateOpen, setGateOpen] = useState(false);
  const [ignoredGateIssues, setIgnoredGateIssues] = useState<Set<string>>(new Set());
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
    setEndpoint(localStorage.getItem(endpointKey) ?? '');
    setModel(localStorage.getItem(modelKey) ?? '');
    setAiEnabled(localStorage.getItem(aiKey) === '1');
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
  const split = useMemo(() => sourceText ? splitEpisodes(sourceText) : null, [sourceText]);
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

  const boundIds = useMemo(() => new Set(episode?.segments.flatMap((item) => item.imageIds) ?? []), [episode]);
  const unassigned = useMemo(() => (episode?.images ?? []).filter((image) => image.matchConfidence && !boundIds.has(image.id)), [episode, boundIds]);
  const lowConfidence = useMemo(() => (episode?.images ?? []).filter((image) => image.matchConfidence === 'low'), [episode]);

  const saveSettings = useCallback((next: { endpoint?: string; model?: string; ai?: boolean }) => {
    if (next.endpoint !== undefined) { setEndpoint(next.endpoint); localStorage.setItem(endpointKey, next.endpoint); }
    if (next.model !== undefined) { setModel(next.model); localStorage.setItem(modelKey, next.model); }
    if (next.ai !== undefined) { setAiEnabled(next.ai); localStorage.setItem(aiKey, next.ai ? '1' : '0'); }
  }, []);

  /** 传给 memo 化面板的稳定回调：避免函数引用变化让子面板失去 memo 收益。 */
  const onMessage = useCallback((next: string) => setMessage(next), []);

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
    if (!endpoint.trim() || !apiKey.trim()) { setConnection({ ok: false, message: '请先填写接口地址与密钥' }); return; }
    setConnection({ ok: true, message: '正在测试连接…' });
    try { setConnection(await requestConnectionTest({ endpoint: endpoint.trim(), model: model.trim() || undefined, apiKey: apiKey.trim() })); }
    catch (error) { setConnection({ ok: false, message: `测试连接失败：${String(error)}` }); }
  }
  async function pickImages(files: FileList) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    try {
      const prepared: ReferenceImage[] = [];
      let failed = 0;
      for (const file of list) {
        try {
          const image = await prepareImage(file, imageKind);
          const sampled = await samplePixels(image.dataUrl);
          const roster = episode ? subjectRoster(buildRoster(episode)) : { characters: [], scenes: [] };
          const analysis = analyzeImage({ name: image.name, width: sampled.width, height: sampled.height, pixels: sampled.pixels }, roster);
          prepared.push({ ...image, description: buildLocalDescription({ name: image.name, analysis }), analysis });
        } catch { failed += 1; }
      }
      const { added, duplicates } = store.addImages(prepared);
      setMessage(`已入库 ${added} 张${duplicates ? `，跳过重复 ${duplicates} 张` : ''}${failed ? `，失败 ${failed} 张` : ''}；导入不设数量上限，每段最多绑定 6 张`);
    } finally { setBusy(false); }
  }
  async function describeOne(image: ReferenceImage) {
    if (!endpoint.trim() || !model.trim() || !apiKey.trim()) { setMessage('请先在接口设置中填写地址、模型和密钥'); return; }
    setBusy(true);
    try {
      const roster: Roster | undefined = episode ? subjectRoster(buildRoster(episode)) : undefined;
      const result = await requestDescription({ endpoint: endpoint.trim(), model: model.trim(), apiKey: apiKey.trim(), image, candidates: roster });
      store.updateImage(image.id, result.description);
      setMessage('图片描述已生成（AI 增强），请核对并确认');
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
      store.updateImage(image.id, buildLocalDescription({ name: image.name, analysis }));
      setMessage('本地描述已生成，请核对并确认');
    } catch (error) { setMessage(`本地描述失败：${String(error)}`); }
  }

  async function describeLocalMissing() {
    if (!episode || busy) return;
    setBusy(true);
    try {
      const targets = episode.images.filter((image) => !image.description.trim());
      for (const image of targets) await describeLocalOne(image, true);
      setMessage(targets.length ? `已为 ${targets.length} 张未描述图片生成本地描述，请逐张确认` : '没有空白描述的图片');
    } finally { setBusy(false); }
  }

  function clearAllImageDescriptions() {
    if (!episode) return;
    const described = episode.images.filter((image) => image.description.trim());
    for (const image of described) store.updateImage(image.id, '');
    setMessage(described.length ? `已清空 ${described.length} 张图片的描述` : '当前图片库没有描述内容');
  }

  /** 本地引擎 A：逐图分析（图类 / 主体 / 光影色彩），零 API，可对任意一集执行。 */
  async function analyzeLocal(target: Episode, prefix: string, base: number, span: number): Promise<Map<string, ImageAnalysis>> {
    const roster = subjectRoster(buildRoster(target));
    const result = new Map<string, ImageAnalysis>();
    const head = prefix ? `${prefix} · 本地图像分析` : '本地图像分析';
    for (const [index, image] of target.images.entries()) {
      setProgress({ running: true, label: `${head} ${index + 1}/${target.images.length}`, value: base + (target.images.length ? (index / target.images.length) * span : span) });
      let pixels: ArrayLike<number> | null = null; let width = 0; let height = 0;
      try { const sampled = await samplePixels(image.dataUrl); pixels = sampled.pixels; width = sampled.width; height = sampled.height; } catch { /* 采样失败按无像素处理 */ }
      result.set(image.id, analyzeImage({ name: image.name, width, height, pixels }, roster));
    }
    return result;
  }

  /** 一键生成（本集）：本地识别 → 自动匹配 → 自动生成导演意图与正文字段 → 校验。AI 可选，失败自动回退。 */
  async function oneClick() {
    if (!project || busy) return;
    const target = activeEpisode(project);
    setBusy(true); setMatchNote('');
    try {
      setProgress({ running: true, label: '本地图像分析', value: 0 });
      const local = await analyzeLocal(target, '', 0, 0.4);
      setAnalyses(local);

      setProgress({ running: true, label: '参考图自动匹配', value: 0.5 });
      const roster = buildRoster(target);
      const outcomes = matchImages(target, local, roster);
      store.applyMatch(outcomes.map((outcome) => ({ imageId: outcome.imageId, segmentIds: outcome.segmentIds, confidence: outcome.confidence, source: outcome.source, reason: outcome.reason })));
      const unassignedCount = outcomes.filter((outcome) => !outcome.segmentIds.length).length;
      const mediumCount = outcomes.filter((outcome) => outcome.confidence === 'medium').length;
      setMatchNote(`匹配完成：${outcomes.length} 张图，中置信度 ${mediumCount} 张需复核，未分配 ${unassignedCount} 张`);

      setProgress({ running: true, label: '规则导演自动生成意图与正文', value: 0.7 });
      const drafts = generateEpisodeDrafts(project, target, local);
      let filled = 0;
      for (const [segmentId, list] of drafts) filled += store.applyGenerated(segmentId, list, { overwrite, source: 'local' });
      setMessage(`本地规则导演已填充 ${filled} 条字段，并标记 ${drafts.size} 段导演决策已生成${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);

      if (aiEnabled && endpoint.trim() && model.trim() && apiKey.trim()) {
        setProgress({ running: true, label: 'AI 增强通道', value: 0.85 });
        let aiFilled = 0; let aiFailed = 0;
        for (const item of target.segments) {
          const images = item.imageIds.map((id) => target.images.find((image) => image.id === id)).filter((image): image is ReferenceImage => !!image && image.confirmed);
          try {
            const shots = await requestSegmentFields({
              endpoint: endpoint.trim(), model: model.trim(), apiKey: apiKey.trim(),
              segment: {
                id: item.id, mode: item.mode,
                shots: item.shots.map((entry) => ({
                  id: entry.id, duration: entry.duration,
                  beatText: target.beats.filter((beat) => entry.beatIds.includes(beat.id)).map((beat) => beat.text).join(' / '),
                  dialogue: entry.dialogue.map((dialogue) => `${dialogue.speaker}：${dialogue.text}`).join('｜'),
                })),
              },
              context: {
                contentType: project.contentType, mode: item.mode,
                characters: project.visual.character, scene: project.visual.scene,
                imageDescriptions: images.map((image) => image.description.trim()),
                previousBlocking: '', previousLight: '', previousTransition: '',
              },
            });
            const safe = shots.map((entry) => ({ shotId: entry.shotId, source: 'ai' as const, duration: shotDuration, fields: Object.fromEntries(generatedKeys.filter((key) => typeof entry.fields[key] === 'string' && entry.fields[key].trim()).map((key) => [key, entry.fields[key]])) }));
            aiFilled += store.applyGenerated(item.id, safe, { overwrite: true, source: 'ai' });
          } catch { aiFailed += 1; }
        }
        setMessage(aiFailed ? `AI 增强完成 ${aiFilled} 条，${aiFailed} 段未通过校验已回退本地结果` : `AI 增强已覆盖 ${aiFilled} 条字段，校验通过`);
      }
    } catch (error) { setMessage(`一键生成失败：${String(error)}`); }
    finally { setBusy(false); setProgress(null); }
  }

  /**
   * 全部分集生成：逐集做图像分析 → 匹配 → 规则导演回填，整本一次写入并标记每段「导演决策已生成」。
   * 单集失败隔离，不阻断其余集。
   */
  async function generateAll() {
    if (!project || busy) return;
    const book = project;
    const total = book.episodes.length;
    setBusy(true); setMatchNote('');
    try {
      const entries: GenerationBatchEntry[] = [];
      const analysisByEpisode = new Map<string, Map<string, ImageAnalysis>>();
      let failed = 0;
      for (const [index, item] of book.episodes.entries()) {
        try {
          const slot = 0.9 / total;
          if (!item.segments.length) continue;
          const local = await analyzeLocal(item, item.label, index * slot, slot * 0.5);
          analysisByEpisode.set(item.id, local);
          setProgress({ running: true, label: `${item.label} · 参考图自动匹配与规则导演生成`, value: index * slot + slot * 0.6 });
          const outcomes = matchImages(item, local, buildRoster(item));
          const drafts = generateEpisodeDrafts(book, item, local);
          entries.push({
            episodeId: item.id,
            assignments: outcomes.map((outcome) => ({ imageId: outcome.imageId, segmentIds: outcome.segmentIds, confidence: outcome.confidence, source: outcome.source, reason: outcome.reason })),
            drafts: [...drafts].map(([segmentId, list]) => ({ segmentId, drafts: list })),
          });
        } catch { failed += 1; }
      }
      setProgress({ running: true, label: '整本一次写入并标记已生成', value: 0.95 });
      const result = store.applyGenerationBatch(entries, { overwrite, source: 'local' });
      setAnalyses(analysisByEpisode.get(activeEpisode(book).id) ?? new Map());
      setMatchNote(`全部分集生成完成：处理 ${entries.length}/${total} 集，填充 ${result.filled} 条字段，${result.segments} 段导演决策已生成${failed ? `，${failed} 集失败已隔离` : ''}`);
      setMessage(`全部分集生成完成：${entries.length}/${total} 集逐集分析并回填，${result.segments} 段已标记导演决策已生成${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);
    } catch (error) { setMessage(`全部分集生成失败：${String(error)}`); }
    finally { setBusy(false); setProgress(null); }
  }

  const progressPanel = progress && <div className="progress-panel" role="status"><strong>{progress.label}</strong><div className="progress-track"><div style={{ width: `${Math.round(progress.value * 100)}%` }} /></div></div>;

  const settingsPanel = settingsOpen && <div className="settings-panel" role="dialog" aria-label="接口设置">
    <div className="settings-head"><h3>接口设置（可选增强）</h3><button onClick={() => setSettingsOpen(false)}>关闭</button></div>
    <p className="settings-note">默认关闭 AI 增强，不接接口也能完成本地识别、拆分与生成。密钥仅保存在本次会话内存，不写入项目快照。</p>
    <label className="ai-switch"><input type="checkbox" aria-label="启用AI增强" checked={aiEnabled} onChange={(event) => saveSettings({ ai: event.target.checked })} />启用 AI 增强（图片外观描述 / 剧情语义分镜 / 字段起草）</label>
    <label>接口地址<input aria-label="接口地址" value={endpoint} onChange={(event) => saveSettings({ endpoint: event.target.value })} placeholder="https://…/v1/chat/completions" /></label>
    <label>模型<input aria-label="模型" value={model} onChange={(event) => saveSettings({ model: event.target.value })} /></label>
    <label>密钥<input aria-label="接口密钥" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>
    <div className="settings-actions"><button onClick={testConnection}>测试连接</button>{connection && <span className={connection.ok ? 'ok' : 'fail'}>{connection.message}</span>}</div>
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

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">分</span><div><strong>剧本拆分工作台</strong><small>MINIMAX H3 / 分镜正本</small></div></div>
      <div className="toolbar">
        <button onClick={openFile} title="导入 TXT、Markdown、Word 或项目快照"><FileInput size={17} />导入</button>
        <button onClick={() => void clearWorkspace()} title="清空当前项目与本地缓存"><Trash2 size={17} />清空</button>
        <button onClick={() => { store.importScript(sample, '验收样例'); setAnalyses(new Map()); setMessage('样例已载入，导演字段等待确认'); }} title="载入验收样例"><FilePlus2 size={17} />样例</button>
        <button className="primary" onClick={oneClick} disabled={!project || busy} title="本集：本地识别 → 自动匹配 → 填充 10 条导演字段"><Sparkles size={17} />一键生成</button>
        <button onClick={generateAll} disabled={!project || busy} title="逐集分析并回填全部集，逐段标记导演决策已生成"><Layers size={17} />全部分集生成</button>
        <button onClick={() => setSettingsOpen(true)} title="配置可选 AI 增强接口"><Settings size={17} />接口设置</button>
        <button onClick={saveProject} disabled={!project} title="保存可恢复的项目快照"><Save size={17} />保存项目</button>
        <button onClick={() => void exportFile()} disabled={!project || busy} title={errors.length ? `本集 ${errors.length} 项阻断，点击查看全书清单` : '导出本集 TXT 分镜'}><Download size={17} />导出 TXT</button>
        <button onClick={() => void exportWord()} disabled={!project || busy} title={errors.length ? `本集 ${errors.length} 项阻断，点击查看全书清单` : '导出本集 Word 分镜'}><Download size={17} />导出 Word</button>
      </div>
    </header>
    {settingsPanel}
    {gatePanel}
    {storageError && <div className="save-warning" role="alert">本地存档读取失败：磁盘上仍有这份存档（未被覆盖），但当前版本读不出来，所以工作台显示为空。请先「保存项目」或手工备份原存档，再开始新的编辑 —— 直接编辑并自动保存会覆盖掉它。</div>}
    {!project ? <main className="empty-workspace"><div className="empty-icon"><PanelRight size={32} /></div><h1>从原剧本开始</h1><p>导入整本剧本与批量参考图片，一键生成本地识别的 14 条分镜；AI 增强为可选项。</p><div className="empty-actions"><button className="primary" onClick={openFile}><FileInput size={17} />导入剧本</button><button onClick={() => { store.importScript(sample, '验收样例'); }}><Play size={17} />打开样例</button><button onClick={() => setSettingsOpen(true)}><Settings size={17} />接口设置</button></div></main> : episode && <>
      <div className="episode-bar">
        <div className="episode-list">{project.episodes.map((item) => <button key={item.id} className={item.id === episode.id ? 'active' : ''} onClick={() => store.selectEpisode(item.id)} title={item.label}>{item.label}<small>{item.segments.length} 段</small></button>)}</div>
        <div className="episode-note"><span className="episode-note-text">{split?.recognized ? `已自动识别 ${project.episodes.length} 集` : split?.reason}</span>{!episode.splitVerified && <button onClick={() => store.verifySplit()}>核对分集</button>}</div>
      </div>
      <details className="split-list" open={splitOpen} onToggle={(event) => setSplitOpen(event.currentTarget.open)}><summary>分集核对清单（集号 / 标题 / 字数 / 场次 / 切点行号）</summary>{splitOpen && <table><thead><tr><th>集号</th><th>标题</th><th>字数</th><th>场次</th><th>切点行号</th></tr></thead><tbody>
        {project.episodes.map((item, index) => <tr key={item.id} className={item.id === episode.id ? 'active' : ''}><td>{item.label}</td><td>{split?.episodes[index]?.title || '—'}</td><td>{split?.episodes[index]?.charCount ?? 0}</td><td>{item.scenes.length}</td><td>{split ? `${split.episodes[index]?.startLine}–${split.episodes[index]?.endLine}` : '—'}</td></tr>)}
      </tbody></table>}</details>
      <div className="projectbar"><div><input aria-label="作品名称" value={project.title} onChange={(event) => store.setProject({ ...project, title: event.target.value || '未命名作品' }, false)} /><span className="episode">{episode.label}</span><span className="tag">{typeNames[project.contentType]}</span></div><div className="project-controls"><span className={`validation-status ${validationState}`}>{validationState === 'validating' ? '正在校验…' : validationState === 'ready' ? '校验完成' : ''}</span><label>整集规划模式 <select aria-label="整集规划模式" value={project.defaultMode} onChange={(event) => store.setMode(event.target.value as DefaultMode)}>{Object.entries(modeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>内容类型 <select aria-label="内容类型" value={project.contentType} onChange={(event) => store.setProject({ ...project, contentType: event.target.value as typeof project.contentType }, false)}>{Object.entries(typeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="overwrite"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />覆盖已有内容</label><button onClick={() => { if (window.confirm('重新规划将替换所有未另存的导演板编辑。继续？')) store.replan(); }} title="按当前原稿和模式重新拆段">重新规划</button></div></div>
      {autosaveError && <div className="save-warning" role="alert">本地存档写入失败，当前改动未自动保存。请立即“保存项目”留存 JSON 快照。</div>}
      {migrated && <div className="save-warning" role="status">已从 v1.0 单集存档自动迁移到 v1.1 多集结构（1 集），旧数据未丢失。</div>}
      {progressPanel}
      <main className="workspace">
        <SourcePane projectId={project.id} sceneCount={episode.scenes.length} beatCount={episode.beats.length} filename={source?.filename ?? ''} scriptId={project.activeScriptId} sourceText={sourceText} onMessage={onMessage} />
        <section className="pane input-image-pane" aria-label="输入图片"><div className="pane-title"><h2>输入图片</h2><span>{episode.images.length} 张已入库 · 本段 {segment?.imageIds.length ?? 0}/6</span></div><div className="image-settings">
          <div className="image-add"><select aria-label="图片类型" value={imageKind} onChange={(event) => setImageKind(event.target.value as ReferenceImage['kind'])}><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option></select><input ref={imageInput} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="选择参考图片" onChange={(event) => { if (event.target.files?.length) void pickImages(event.target.files); event.target.value = ''; }} /><button onClick={() => imageInput.current?.click()} disabled={busy} title="批量导入参考图片，不设数量上限"><ImagePlus size={15} />批量导入图片</button><button onClick={() => void describeLocalMissing()} disabled={busy || !episode?.images.length} title="只为描述为空的图片生成本地描述">补齐本地描述</button><button onClick={clearAllImageDescriptions} disabled={!episode?.images.some((image) => image.description.trim())} title="清空本集全部图片描述，保留图片和分析数据">清空描述</button></div>
          {matchNote && <p className="match-note">{matchNote}</p>}
          {(lowConfidence.length > 0 || unassigned.length > 0) && <div className="unassigned-zone"><strong>未分配区</strong>{unassigned.map((image) => <span key={image.id} className={`chip ${image.matchConfidence}`}>{image.name}<em>{confidenceNames[image.matchConfidence ?? 'low']}置信度</em></span>)}{!unassigned.length && lowConfidence.map((image) => <span key={image.id} className="chip low">{image.name}<em>低置信度</em></span>)}</div>}
          {episode.images.map((image) => <div className={`image-item ${image.matchConfidence === 'medium' ? 'review' : ''}`} key={image.id}><img src={image.dataUrl} alt={image.name} loading="lazy" decoding="async" /><div className="image-detail"><strong>{image.name}</strong><small>{image.kind === 'character' ? '人物' : image.kind === 'scene' ? '场景' : '道具'} · SHA-256 {image.sha256.slice(0, 10)} · v{image.version}{image.matchConfidence ? ` · ${confidenceNames[image.matchConfidence]}置信度` : ''}{image.analysis ? ` · ${image.analysis.kindReason}` : ''}</small>{image.analysis?.dominant.length ? <div className="palette" aria-label={`${image.name}色卡`}>{image.analysis.dominant.map((color) => <span key={color} title={color} aria-label={color} style={{ backgroundColor: color }} />)}</div> : null}<label className="image-use"><input type="checkbox" checked={!!segment?.imageIds.includes(image.id)} disabled={!segment || (!!segment && !segment.imageIds.includes(image.id) && segment.imageIds.length >= 6)} onChange={() => { if (segment && !store.toggleImage(segment.id, image.id)) setMessage('本段已绑定 6 张参考图（上限），该图保留在库中标记为已入库未绑定'); }} />用于本段</label><textarea aria-label={`${image.name}描述`} value={image.description} onChange={(event) => store.updateImage(image.id, event.target.value)} placeholder="导入后会自动生成本地描述，可继续人工补充" /><div className="image-actions"><button onClick={() => store.confirmImage(image.id)} disabled={image.confirmed || !image.description.trim()}><Check size={14} />{image.confirmed ? '已确认' : '确认描述'}</button><button onClick={() => void describeLocalOne(image)} disabled={busy}>本地生成描述</button><button onClick={() => void describeOne(image)} disabled={busy}>AI 生成描述</button></div></div></div>)}
        </div></section>
        <section className="pane director-pane"><div className="pane-title"><h2>导演板</h2><span>{episode.segments.length} 段 · 文{episode.segments.filter((item) => item.mode === 'dialogue').length} / 武{episode.segments.filter((item) => item.mode === 'action').length} · 已生成 {episode.segments.filter((item) => item.directorGenerated).length}/{episode.segments.length}</span></div><div className="segment-strip">{episode.segments.map((item) => <button key={item.id} className={item.id === segment?.id ? 'selected' : ''} onClick={() => store.selectSegment(item.id)}><strong>{item.id}</strong><small>{modeNames[item.mode]} · 15s</small>{item.directorGenerated && <em className="gen-tag">已生成</em>}{!item.confirmed && <span className="dot" />}</button>)}</div><div className="mode-note">综合模式按剧情节拍逐段选文/武，不固定段数配比。</div>
          <div className="visual-settings"><div className="section-heading"><h3>视觉文字设定 <span>v{project.visual.version}</span></h3><button onClick={() => store.confirmVisual()} disabled={project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim()}><Check size={15} />{project.visual.confirmed ? '已确认' : '确认设定'}</button></div><label>人物固定锚点<textarea aria-label="人物固定锚点" value={project.visual.character} onChange={(event) => store.updateVisual('character', event.target.value)} placeholder="面部特征、发型、服装；缺图时使用人工确认的文字设定" /></label><label>场景固定锚点<textarea aria-label="场景固定锚点" value={project.visual.scene} onChange={(event) => store.updateVisual('scene', event.target.value)} placeholder="门窗、家具、光源及轴线方位" /></label></div>
          {segment && <div className="segment-editor"><div className="section-heading"><h3>{segment.id} <span>{episode.scenes.find((item) => item.id === segment.sceneId)?.title}</span></h3><select aria-label="本段模式" value={segment.mode} onChange={(event) => store.setSegmentMode(segment.id, event.target.value as 'dialogue' | 'action')}><option value="dialogue">文戏</option><option value="action">武戏</option></select></div><div className="beat-summary">{segment.beatIds.map((id) => episode.beats.find((beat) => beat.id === id)?.text).join(' / ')}</div><div className="shot-tabs">{segment.shots.map((item) => <button key={item.id} className={item.id === shot?.id ? 'active' : ''} onClick={() => store.selectShot(item.id)}>{item.id}<small>{item.duration}s</small></button>)}</div>
            {shot && <div className="shot-editor"><div className="shot-heading"><label>导演意图（自动生成）<textarea aria-label="导演意图" value={shot.purpose || '点击一键生成或全部分集生成后自动生成'} readOnly /></label><label className="duration">时长 <input aria-label="镜头时长" type="number" value={shot.duration} readOnly aria-readonly="true" />s（固定15秒）</label>{shot.draftSource && <span className={`source-tag ${shot.draftSource}`}>来源：{sourceNames[shot.draftSource]}</span>}</div><div className="field-grid">{fields.map(({ key, label }, i) => <label key={key}><span>{String.fromCharCode(0x2460 + i)} {label}</span>{key === 'character' || key === 'scene' || key === 'dialogue' ? <div className="readonly-field">{shotValues[i] || '等待确认'}</div> : <textarea aria-label={label} value={shot[key]} onChange={(event) => store.updateShot(shot.id, key as EditableShotKey, event.target.value)} placeholder="待导演确认" />}</label>)}</div></div>}
          </div>}
        </section>
        <section className="pane result-pane"><div className="pane-title"><h2>H3 成品与质检</h2><span className={errors.length ? 'error-count' : 'ready-count'}>{errors.length ? `${errors.length} 项阻断` : '本集可导出'}</span></div><div className="result-tabs"><button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>本段问题 <span>{visibleIssues.length}</span></button><button className={tab === 'result' ? 'active' : ''} onClick={() => setTab('result')}>分镜预览</button></div>{tab === 'issues' ? <div className="issues">{visibleIssues.map((issue, index) => <div className={`issue ${issue.severity}`} key={index}><AlertCircle size={15} /><div><span className={`issue-badge ${issue.severity}`}>{issue.severity === 'error' ? '阻断' : '复核'}</span><strong>{issue.segmentId} {issue.shotId}</strong><p>{issue.message}</p></div></div>)}{!visibleIssues.length && <p>本段没有发现问题。</p>}<p className="issues-note">其他集与本段以外的阻断项，在「全书清单」中逐条列出并可跳转定位。</p></div> : <pre className="preview">{preview}</pre>}<div className="result-footer"><span>来源与版本信息仅保留在项目快照中。</span><button onClick={() => setGateOpen(true)}>全书清单{errors.length ? `（本集 ${errors.length} 项阻断）` : ''}</button></div></section>
      </main>
    </>}
    {message && <div role="status" className="toast"><button className="toast-close" aria-label="关闭提醒" title="关闭提醒" onClick={() => setMessage('')}>×</button><span>{message}</span></div>}
  </div>;
}
