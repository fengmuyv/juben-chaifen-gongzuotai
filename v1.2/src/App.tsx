import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronRight, Download, FileInput, FilePlus2, ImagePlus, PanelRight, Play, Save, Settings, Sparkles } from 'lucide-react';
import { sample } from './fixtures/sample';
import { activeEpisode, activeScript, projectSchema, type DefaultMode, type ImageAnalysis, type ReferenceImage } from './core/model';
import { prepareImage } from './core/images';
import { samplePixels } from './core/pixels';
import { analyzeImage, type Roster } from './core/analyze';
import { buildRoster, matchImages, subjectRoster } from './core/match';
import { splitEpisodes } from './core/episodes';
import { requestConnectionTest, requestDescription, requestSegmentFields } from './core/vision';
import { readWord, writeWord } from './core/word';
import { useWorkbench } from './store';
import { fields, generatedKeys, values, type EditableShotKey } from './platforms/minimax-h3/skeleton';
import { generateEpisodeDrafts } from './platforms/minimax-h3/director';
import { exportBundle, previewText } from './platforms/minimax-h3/compiler';
import { validate } from './platforms/minimax-h3/validator';

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

type Progress = { running: boolean; label: string; value: number };

export default function App() {
  const store = useWorkbench();
  const { project } = store;
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'result' | 'issues'>('issues');
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

  useEffect(() => { void store.hydrate(); }, [store]);
  useEffect(() => {
    setEndpoint(localStorage.getItem(endpointKey) ?? '');
    setModel(localStorage.getItem(modelKey) ?? '');
    setAiEnabled(localStorage.getItem(aiKey) === '1');
  }, []);

  const episode = project ? activeEpisode(project) : null;
  const issues = useMemo(() => project ? validate(project) : [], [project]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const segment = episode?.segments.find((item) => item.id === store.selectedSegment) ?? episode?.segments[0];
  const shot = segment?.shots.find((item) => item.id === store.selectedShot) ?? segment?.shots[0];
  const visibleIssues = issues.filter((issue) => !issue.segmentId || issue.segmentId === segment?.id);
  const source = project ? activeScript(project) : null;
  const preview = project ? previewText(project) : '';
  const split = useMemo(() => project ? splitEpisodes(activeScript(project).text) : null, [project]);

  const boundIds = useMemo(() => new Set(episode?.segments.flatMap((item) => item.imageIds) ?? []), [episode]);
  const unassigned = useMemo(() => (episode?.images ?? []).filter((image) => image.matchConfidence && !boundIds.has(image.id)), [episode, boundIds]);
  const lowConfidence = useMemo(() => (episode?.images ?? []).filter((image) => image.matchConfidence === 'low'), [episode]);

  const saveSettings = useCallback((next: { endpoint?: string; model?: string; ai?: boolean }) => {
    if (next.endpoint !== undefined) { setEndpoint(next.endpoint); localStorage.setItem(endpointKey, next.endpoint); }
    if (next.model !== undefined) { setModel(next.model); localStorage.setItem(modelKey, next.model); }
    if (next.ai !== undefined) { setAiEnabled(next.ai); localStorage.setItem(aiKey, next.ai ? '1' : '0'); }
  }, []);

  async function openFile() {
    try {
      let file: { path: string; content: string } | null = null;
      if (window.workbench) file = await window.workbench.open();
      else {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.txt,.md,.json,.docx';
        file = await new Promise((resolve, reject) => { input.onchange = async () => { try { resolve(input.files?.[0] ? { path: input.files[0].name, content: input.files[0].name.toLowerCase().endsWith('.docx') ? await readWord(await input.files[0].arrayBuffer()) : await input.files[0].text() } : null); } catch (error) { reject(error); } }; input.oncancel = () => resolve(null); input.click(); });
      }
      if (!file) return;
      if (file.path.toLowerCase().endsWith('.json')) store.setProject(projectSchema.parse(JSON.parse(file.content)));
      else {
        const bytes = file.path.toLowerCase().endsWith('.docx') && window.workbench ? Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)) : null;
        store.importScript(bytes ? await readWord(bytes.buffer) : file.content, file.path.split(/[\\/]/).at(-1) ?? '导入剧本');
      }
      setDraft(null); setAnalyses(new Map()); setMatchNote('');
      setMessage('文件已打开');
    } catch (error) { setMessage(`导入失败：${String(error)}`); }
  }
  async function saveProject() {
    if (!project) return;
    try {
      const content = JSON.stringify(project, null, 2);
      if (window.workbench) { const path = await window.workbench.saveProject(content); if (path) setMessage(`项目已保存：${path}`); }
      else download(`${project.title}-项目.json`, content, 'application/json');
    } catch (error) { setMessage(`项目保存失败：${String(error)}`); }
  }
  async function exportFile() {
    if (!project) return;
    try {
      const result = exportBundle(project);
      if (window.workbench) { const path = await window.workbench.saveExport(result.text); if (path) setMessage(`TXT 分镜已导出：${path}`); }
      else download(`${project.title}-${episode?.label ?? ''}-H3分镜.txt`, result.text, 'text/plain;charset=utf-8');
    } catch (error) { setTab('issues'); setMessage(String(error)); }
  }
  async function exportWord() {
    if (!project) return;
    try {
      exportBundle(project);
      const bytes = await writeWord(project);
      if (window.workbench) { const path = await window.workbench.saveWord(Array.from(bytes)); if (path) setMessage(`Word 已导出：${path}`); }
      else download(`${project.title}-${episode?.label ?? ''}-H3分镜.docx`, new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } catch (error) { setTab('issues'); setMessage(`Word 导出失败：${String(error)}`); }
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
      for (const file of list) { try { prepared.push(await prepareImage(file, imageKind)); } catch { failed += 1; } }
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

  /** 本地引擎 A：逐图分析（图类 / 主体 / 光影色彩），零 API。 */
  async function analyzeEpisodeLocal(): Promise<Map<string, ImageAnalysis>> {
    const target = project ? activeEpisode(project) : null;
    if (!target) return new Map();
    const roster = subjectRoster(buildRoster(target));
    const result = new Map<string, ImageAnalysis>();
    for (const [index, image] of target.images.entries()) {
      setProgress({ running: true, label: `本地图像分析 ${index + 1}/${target.images.length}`, value: target.images.length ? (index / target.images.length) * 0.4 : 0.4 });
      let pixels: ArrayLike<number> | null = null; let width = 0; let height = 0;
      try { const sampled = await samplePixels(image.dataUrl); pixels = sampled.pixels; width = sampled.width; height = sampled.height; } catch { /* 采样失败按无像素处理 */ }
      result.set(image.id, analyzeImage({ name: image.name, width, height, pixels }, roster));
    }
    return result;
  }

  /** 一键生成：本地识别 → 自动匹配 → 填充 10 条导演字段 → 校验。AI 可选，失败自动回退。 */
  async function oneClick() {
    if (!project || busy) return;
    const target = activeEpisode(project);
    setBusy(true); setMatchNote('');
    try {
      setProgress({ running: true, label: '本地图像分析', value: 0 });
      const local = await analyzeEpisodeLocal();
      setAnalyses(local);

      setProgress({ running: true, label: '参考图自动匹配', value: 0.5 });
      const roster = buildRoster(target);
      const outcomes = matchImages(target, local, roster);
      store.applyMatch(outcomes.map((outcome) => ({ imageId: outcome.imageId, segmentIds: outcome.segmentIds, confidence: outcome.confidence, source: outcome.source, reason: outcome.reason })));
      const unassignedCount = outcomes.filter((outcome) => !outcome.segmentIds.length).length;
      const mediumCount = outcomes.filter((outcome) => outcome.confidence === 'medium').length;
      setMatchNote(`匹配完成：${outcomes.length} 张图，中置信度 ${mediumCount} 张需复核，未分配 ${unassignedCount} 张`);

      setProgress({ running: true, label: '规则导演生成 10 条字段', value: 0.7 });
      const drafts = generateEpisodeDrafts(project, target, local);
      let filled = 0;
      for (const [segmentId, list] of drafts) filled += store.applyGenerated(segmentId, list, { overwrite, source: 'local' });
      setMessage(`本地规则导演已填充 ${filled} 条字段${overwrite ? '（已按要求覆盖）' : '（仅补空白，不覆盖已有内容）'}`);

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
            const safe = shots.map((entry) => ({ shotId: entry.shotId, source: 'ai' as const, fields: Object.fromEntries(generatedKeys.filter((key) => typeof entry.fields[key] === 'string' && entry.fields[key].trim()).map((key) => [key, entry.fields[key]])) }));
            aiFilled += store.applyGenerated(item.id, safe, { overwrite: true, source: 'ai' });
          } catch { aiFailed += 1; }
        }
        setMessage(aiFailed ? `AI 增强完成 ${aiFilled} 条，${aiFailed} 段未通过校验已回退本地结果` : `AI 增强已覆盖 ${aiFilled} 条字段，校验通过`);
      }
    } catch (error) { setMessage(`一键生成失败：${String(error)}`); }
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

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">分</span><div><strong>剧本拆分工作台</strong><small>MINIMAX H3 / 分镜正本</small></div></div>
      <div className="toolbar">
        <button onClick={openFile} title="导入 TXT、Markdown、Word 或项目快照"><FileInput size={17} />导入</button>
        <button onClick={() => { store.importScript(sample, '验收样例'); setDraft(null); setAnalyses(new Map()); setMessage('样例已载入，导演字段等待确认'); }} title="载入验收样例"><FilePlus2 size={17} />样例</button>
        <button className="primary" onClick={oneClick} disabled={!project || busy} title="本地识别 → 自动匹配 → 填充 10 条导演字段"><Sparkles size={17} />一键生成</button>
        <button onClick={() => setSettingsOpen(true)} title="配置可选 AI 增强接口"><Settings size={17} />接口设置</button>
        <button onClick={saveProject} disabled={!project} title="保存可恢复的项目快照"><Save size={17} />保存项目</button>
        <button onClick={exportFile} disabled={!project || errors.length > 0} title={errors.length ? `有 ${errors.length} 项阻断错误` : '导出 TXT 分镜'}><Download size={17} />导出 TXT</button>
        <button onClick={exportWord} disabled={!project || errors.length > 0} title={errors.length ? `有 ${errors.length} 项阻断错误` : '导出 Word 分镜'}><Download size={17} />导出 Word</button>
      </div>
    </header>
    {settingsPanel}
    {!project ? <main className="empty-workspace"><div className="empty-icon"><PanelRight size={32} /></div><h1>从原剧本开始</h1><p>导入整本剧本与批量参考图片，一键生成本地识别的 14 条分镜；AI 增强为可选项。</p><div className="empty-actions"><button className="primary" onClick={openFile}><FileInput size={17} />导入剧本</button><button onClick={() => { store.importScript(sample, '验收样例'); setDraft(null); }}><Play size={17} />打开样例</button><button onClick={() => setSettingsOpen(true)}><Settings size={17} />接口设置</button></div></main> : episode && <>
      <div className="episode-bar">
        <div className="episode-list">{project.episodes.map((item) => <button key={item.id} className={item.id === episode.id ? 'active' : ''} onClick={() => store.selectEpisode(item.id)} title={item.label}>{item.label}<small>{item.segments.length} 段</small></button>)}</div>
        <div className="episode-note"><span className="episode-note-text">{split?.recognized ? `已自动识别 ${project.episodes.length} 集` : split?.reason}</span>{!episode.splitVerified && <button onClick={() => store.verifySplit()}>核对分集</button>}</div>
      </div>
      <details className="split-list"><summary>分集核对清单（集号 / 标题 / 字数 / 场次 / 切点行号）</summary><table><thead><tr><th>集号</th><th>标题</th><th>字数</th><th>场次</th><th>切点行号</th></tr></thead><tbody>
        {project.episodes.map((item, index) => <tr key={item.id} className={item.id === episode.id ? 'active' : ''}><td>{item.label}</td><td>{split?.episodes[index]?.title || '—'}</td><td>{split?.episodes[index]?.charCount ?? 0}</td><td>{item.scenes.length}</td><td>{split ? `${split.episodes[index]?.startLine}–${split.episodes[index]?.endLine}` : '—'}</td></tr>)}
      </tbody></table></details>
      <div className="projectbar"><div><input aria-label="作品名称" value={project.title} onChange={(event) => store.setProject({ ...project, title: event.target.value || '未命名作品' }, false)} /><span className="episode">{episode.label}</span><span className="tag">{typeNames[project.contentType]}</span></div><div className="project-controls"><label>整集规划模式 <select aria-label="整集规划模式" value={project.defaultMode} onChange={(event) => store.setMode(event.target.value as DefaultMode)}>{Object.entries(modeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>内容类型 <select aria-label="内容类型" value={project.contentType} onChange={(event) => store.setProject({ ...project, contentType: event.target.value as typeof project.contentType }, false)}>{Object.entries(typeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label className="overwrite"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />覆盖已有内容</label><button onClick={() => { if (window.confirm('重新规划将替换所有未另存的导演板编辑。继续？')) store.replan(); }} title="按当前原稿和模式重新拆段">重新规划</button></div></div>
      {store.autosaveError && <div className="save-warning" role="alert">本地存档写入失败，当前改动未自动保存。请立即“保存项目”留存 JSON 快照。</div>}
      {store.migrated && <div className="save-warning" role="status">已从 v1.0 单集存档自动迁移到 v1.1 多集结构（1 集），旧数据未丢失。</div>}
      {progressPanel}
      <main className="workspace">
        <section className="pane source-pane"><div className="pane-title"><h2>原剧本</h2><span>{episode.scenes.length} 场 · {episode.beats.length} 节拍</span></div><div className="source-meta">{source?.filename} · 版本 {project.activeScriptId}</div><textarea aria-label="原剧本编辑区" value={draft ?? source?.text ?? ''} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /><div className="source-footer"><span>编辑后生成新原稿版本；导演板需重新规划。</span><button disabled={draft === null || draft === source?.text} onClick={() => { if (draft === null) return; store.updateScript(draft); setDraft(null); setMessage('新原稿版本已保存；请重新规划'); }}>保存原稿版本</button></div></section>
        <section className="pane director-pane"><div className="pane-title"><h2>导演板</h2><span>{episode.segments.length} 段 · 文{episode.segments.filter((item) => item.mode === 'dialogue').length} / 武{episode.segments.filter((item) => item.mode === 'action').length}</span></div><div className="segment-strip">{episode.segments.map((item) => <button key={item.id} className={item.id === segment?.id ? 'selected' : ''} onClick={() => store.selectSegment(item.id)}><strong>{item.id}</strong><small>{modeNames[item.mode]} · 15s</small>{!item.confirmed && <span className="dot" />}</button>)}</div><div className="mode-note">综合模式按剧情节拍逐段选文/武，不固定段数配比。</div>
          <div className="visual-settings"><div className="section-heading"><h3>视觉文字设定 <span>v{project.visual.version}</span></h3><button onClick={() => store.confirmVisual()} disabled={project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim()}><Check size={15} />{project.visual.confirmed ? '已确认' : '确认设定'}</button></div><label>人物固定锚点<textarea aria-label="人物固定锚点" value={project.visual.character} onChange={(event) => store.updateVisual('character', event.target.value)} placeholder="面部特征、发型、服装；缺图时使用人工确认的文字设定" /></label><label>场景固定锚点<textarea aria-label="场景固定锚点" value={project.visual.scene} onChange={(event) => store.updateVisual('scene', event.target.value)} placeholder="门窗、家具、光源及轴线方位" /></label></div>
          <div className="image-settings"><div className="section-heading"><h3>参考图片</h3><span>{episode.images.length} 张已入库 · 本段 {segment?.imageIds.length ?? 0}/6</span></div><div className="image-add"><select aria-label="图片类型" value={imageKind} onChange={(event) => setImageKind(event.target.value as ReferenceImage['kind'])}><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option></select><input ref={imageInput} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="选择参考图片" onChange={(event) => { if (event.target.files?.length) void pickImages(event.target.files); event.target.value = ''; }} /><button onClick={() => imageInput.current?.click()} disabled={busy} title="批量导入参考图片，不设数量上限"><ImagePlus size={15} />批量导入图片</button></div>
            {matchNote && <p className="match-note">{matchNote}</p>}
            {(lowConfidence.length > 0 || unassigned.length > 0) && <div className="unassigned-zone"><strong>未分配区</strong>{unassigned.map((image) => <span key={image.id} className={`chip ${image.matchConfidence}`}>{image.name}<em>{confidenceNames[image.matchConfidence ?? 'low']}置信度</em></span>)}{!unassigned.length && lowConfidence.map((image) => <span key={image.id} className="chip low">{image.name}<em>低置信度</em></span>)}</div>}
            {episode.images.map((image) => <div className={`image-item ${image.matchConfidence === 'medium' ? 'review' : ''}`} key={image.id}><img src={image.dataUrl} alt={image.name} /><div className="image-detail"><strong>{image.name}</strong><small>{image.kind === 'character' ? '人物' : image.kind === 'scene' ? '场景' : '道具'} · SHA-256 {image.sha256.slice(0, 10)} · v{image.version}{image.matchConfidence ? ` · ${confidenceNames[image.matchConfidence]}置信度` : ''}{image.analysis ? ` · ${image.analysis.kindReason}` : ''}</small><label className="image-use"><input type="checkbox" checked={!!segment?.imageIds.includes(image.id)} disabled={!segment || (!!segment && !segment.imageIds.includes(image.id) && segment.imageIds.length >= 6)} onChange={() => { if (segment && !store.toggleImage(segment.id, image.id)) setMessage('本段已绑定 6 张参考图（上限），该图保留在库中标记为已入库未绑定'); }} />用于本段</label><textarea aria-label={`${image.name}描述`} value={image.description} onChange={(event) => store.updateImage(image.id, event.target.value)} placeholder="本地只给图类与光影；外观描述需人工文字设定或开启 AI 增强" /><div className="image-actions"><button onClick={() => store.confirmImage(image.id)} disabled={image.confirmed || !image.description.trim()}><Check size={14} />{image.confirmed ? '已确认' : '确认描述'}</button><button onClick={() => void describeOne(image)} disabled={busy}>AI 生成描述</button></div></div></div>)}
          </div>
          {segment && <div className="segment-editor"><div className="section-heading"><h3>{segment.id} <span>{episode.scenes.find((item) => item.id === segment.sceneId)?.title}</span></h3><select aria-label="本段模式" value={segment.mode} onChange={(event) => store.setSegmentMode(segment.id, event.target.value as 'dialogue' | 'action')}><option value="dialogue">文戏</option><option value="action">武戏</option></select></div><div className="beat-summary">{segment.beatIds.map((id) => episode.beats.find((beat) => beat.id === id)?.text).join(' / ')}</div><div className="shot-tabs">{segment.shots.map((item) => <button key={item.id} className={item.id === shot?.id ? 'active' : ''} onClick={() => store.selectShot(item.id)}>{item.id}<small>{item.duration}s</small></button>)}</div>
            {shot && <div className="shot-editor"><div className="shot-heading"><label>导演意图<input aria-label="导演意图" value={shot.purpose} onChange={(event) => store.updateShot(shot.id, 'purpose', event.target.value)} placeholder="观众在这镜得到什么信息" /></label><label className="duration">时长 <input aria-label="镜头时长" type="number" min="0.1" step="0.5" value={shot.duration} onChange={(event) => store.updateShot(shot.id, 'duration', Number(event.target.value))} />s</label>{shot.draftSource && <span className={`source-tag ${shot.draftSource}`}>来源：{sourceNames[shot.draftSource]}</span>}</div><div className="field-grid">{fields.map(({ key, label }, i) => <label key={key}><span>{String.fromCharCode(0x2460 + i)} {label}</span>{key === 'character' || key === 'scene' || key === 'dialogue' ? <div className="readonly-field">{values(project, shot)[i] || '等待确认'}</div> : <textarea aria-label={label} value={shot[key]} onChange={(event) => store.updateShot(shot.id, key as EditableShotKey, event.target.value)} placeholder="待导演确认" />}</label>)}</div></div>}
            <div className="confirm-row"><button onClick={() => store.confirmSegment(segment.id)} disabled={segment.confirmed}><Check size={15} />{segment.confirmed ? '本段已确认' : '确认本段导演决定'}</button></div></div>}
        </section>
        <section className="pane result-pane"><div className="pane-title"><h2>H3 成品与质检</h2><span className={errors.length ? 'error-count' : 'ready-count'}>{errors.length ? `${errors.length} 项阻断` : '可导出'}</span></div><div className="result-tabs"><button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>本段问题 <span>{visibleIssues.length}</span></button><button className={tab === 'result' ? 'active' : ''} onClick={() => setTab('result')}>分镜预览</button></div>{tab === 'issues' ? <div className="issues">{visibleIssues.map((issue, index) => <div className={`issue ${issue.severity}`} key={index}><AlertCircle size={15} /><div><strong>{issue.segmentId} {issue.shotId}</strong><p>{issue.message}</p></div></div>)}{!visibleIssues.length && <p>本段没有发现问题。</p>}</div> : <pre className="preview">{preview}</pre>}<div className="result-footer"><span>来源与版本信息仅保留在项目快照中。</span><ChevronRight size={16} /></div></section>
      </main>
    </>}
    {message && <div role="status" className="toast" onClick={() => setMessage('')}>{message} ×</div>}
  </div>;
}
