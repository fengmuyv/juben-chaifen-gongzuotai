import { useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronRight, Download, FileInput, FilePlus2, ImagePlus, PanelRight, Play, Save } from 'lucide-react';
import { sample } from './fixtures/sample';
import { activeScript, projectSchema, type DefaultMode, type ReferenceImage } from './core/model';
import { prepareImage } from './core/images';
import { requestDescription } from './core/vision';
import { readWord, writeWord } from './core/word';
import { useWorkbench } from './store';
import { fields, values, type EditableShotKey } from './platforms/minimax-h3/skeleton';
import { exportBundle, previewText } from './platforms/minimax-h3/compiler';
import { validate } from './platforms/minimax-h3/validator';

const modeNames = { dialogue: '文戏', action: '武戏', combined: '综合' };
const typeNames = { 'short-drama': '短剧', 'mid-drama': '中剧', 'long-drama': '长剧', film: '电影' };
function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const store = useWorkbench();
  const { project, selectedSegment, selectedShot } = store;
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'result' | 'issues'>('issues');
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageKind, setImageKind] = useState<ReferenceImage['kind']>('character');
  const [visionEndpoint, setVisionEndpoint] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [visionKey, setVisionKey] = useState('');
  const [busyImage, setBusyImage] = useState<string | null>(null);
  const issues = useMemo(() => project ? validate(project) : [], [project]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const segment = project?.segments.find((item) => item.id === selectedSegment) ?? project?.segments[0];
  const shot = segment?.shots.find((item) => item.id === selectedShot) ?? segment?.shots[0];
  const visibleIssues = issues.filter((issue) => !issue.segmentId || issue.segmentId === segment?.id);
  const source = project ? activeScript(project) : null;
  const preview = project ? previewText(project) : '';

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
      setDraft(null);
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
      else download(`${project.title}-${project.episode}-H3分镜.txt`, result.text, 'text/plain;charset=utf-8');
    } catch (error) { setTab('issues'); setMessage(String(error)); }
  }
  async function exportWord() {
    if (!project) return;
    try {
      exportBundle(project);
      const bytes = await writeWord(project);
      if (window.workbench) { const path = await window.workbench.saveWord(Array.from(bytes)); if (path) setMessage(`Word 已导出：${path}`); }
      else download(`${project.title}-${project.episode}-H3分镜.docx`, new Uint8Array(bytes), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } catch (error) { setTab('issues'); setMessage(`Word 导出失败：${String(error)}`); }
  }
  async function generateDescription(image: ReferenceImage) {
    if (!visionEndpoint.trim() || !visionModel.trim() || !visionKey.trim()) { setMessage('请先填写视觉接口地址、模型和密钥，再生成描述'); return; }
    setBusyImage(image.id);
    try {
      const description = await requestDescription({ endpoint: visionEndpoint.trim(), model: visionModel.trim(), apiKey: visionKey.trim(), image });
      store.updateImage(image.id, description);
      setMessage('图片描述已生成，请核对并确认');
    } catch (error) { setMessage(`图片描述失败：${String(error)}`); }
    finally { setBusyImage(null); }
  }
  async function uploadImage(file: File) {
    try {
      const image = await prepareImage(file, imageKind);
      if (project?.images.some((item) => item.sha256 === image.sha256)) { setMessage('同一图片已导入，请使用现有描述'); return; }
      store.addImage(image);
      if (segment) store.toggleImage(segment.id, image.id);
      await generateDescription(image);
    } catch (error) { setMessage(`图片导入失败：${String(error)}`); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">分</span><div><strong>剧本拆分工作台</strong><small>MINIMAX H3 / 分镜正本</small></div></div>
      <div className="toolbar">
        <button onClick={openFile} title="导入 TXT、Markdown、Word 或项目快照"><FileInput size={17} />导入</button>
        <button onClick={() => { store.importScript(sample, '验收样例'); setDraft(null); setMessage('样例已载入，导演字段等待确认'); }} title="载入验收样例"><FilePlus2 size={17} />样例</button>
        <button onClick={saveProject} disabled={!project} title="保存可恢复的项目快照"><Save size={17} />保存项目</button>
        <button className="primary" onClick={exportFile} disabled={!project || errors.length > 0} title={errors.length ? `有 ${errors.length} 项阻断错误` : '导出 TXT 分镜'}><Download size={17} />导出 TXT</button>
        <button onClick={exportWord} disabled={!project || errors.length > 0} title={errors.length ? `有 ${errors.length} 项阻断错误` : '导出 Word 分镜'}><Download size={17} />导出 Word</button>
      </div>
    </header>
    {!project ? <main className="empty-workspace"><div className="empty-icon"><PanelRight size={32} /></div><h1>从原剧本开始</h1><p>导入 TXT / Markdown / Word，或打开验收样例。原文保留，拆分结果可逐镜修改。</p><div className="empty-actions"><button className="primary" onClick={openFile}><FileInput size={17} />导入剧本</button><button onClick={() => { store.importScript(sample, '验收样例'); setDraft(null); }}><Play size={17} />打开样例</button></div></main> : <>
      <div className="projectbar"><div><input aria-label="作品名称" value={project.title} onChange={(event) => store.setProject({ ...project, title: event.target.value || '未命名作品' })} /><span className="episode">{project.episode}</span><span className="tag">{typeNames[project.contentType]}</span></div><div className="project-controls"><label>整集规划模式 <select aria-label="整集规划模式" value={project.defaultMode} onChange={(event) => store.setMode(event.target.value as DefaultMode)}>{Object.entries(modeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>内容类型 <select aria-label="内容类型" value={project.contentType} onChange={(event) => store.setProject({ ...project, contentType: event.target.value as typeof project.contentType })}>{Object.entries(typeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><button onClick={() => { if (window.confirm('重新规划将替换所有未另存的导演板编辑。继续？')) store.replan(); }} title="按当前原稿和模式重新拆段">重新规划</button></div></div>
      {store.autosaveError && <div className="save-warning" role="alert">浏览器草稿容量不足，当前改动未自动保存。请立即“保存项目”留存 JSON 快照。</div>}
      <main className="workspace">
        <section className="pane source-pane"><div className="pane-title"><h2>原剧本</h2><span>{project.scenes.length} 场 · {project.beats.length} 节拍</span></div><div className="source-meta">{source?.filename} · 版本 {project.activeScriptId}</div><textarea aria-label="原剧本编辑区" value={draft ?? source?.text ?? ''} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /><div className="source-footer"><span>编辑后生成新原稿版本；导演板需重新规划。</span><button disabled={draft === null || draft === source?.text} onClick={() => { if (draft === null) return; store.updateScript(draft); setDraft(null); setMessage('新原稿版本已保存；请重新规划'); }}>保存原稿版本</button></div></section>
        <section className="pane director-pane"><div className="pane-title"><h2>导演板</h2><span>{project.segments.length} 段 · 文{project.segments.filter((item) => item.mode === 'dialogue').length} / 武{project.segments.filter((item) => item.mode === 'action').length}</span></div><div className="segment-strip">{project.segments.map((item) => <button key={item.id} className={item.id === segment?.id ? 'selected' : ''} onClick={() => store.selectSegment(item.id)}><strong>{item.id}</strong><small>{modeNames[item.mode]} · 15s</small>{!item.confirmed && <span className="dot" />}</button>)}</div><div className="mode-note">综合模式按剧情节拍逐段选文/武，不固定段数配比。</div>
          <div className="visual-settings"><div className="section-heading"><h3>视觉文字设定 <span>v{project.visual.version}</span></h3><button onClick={() => store.confirmVisual()} disabled={project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim()}><Check size={15} />{project.visual.confirmed ? '已确认' : '确认设定'}</button></div><label>人物固定锚点<textarea aria-label="人物固定锚点" value={project.visual.character} onChange={(event) => store.updateVisual('character', event.target.value)} placeholder="面部特征、发型、服装；缺图时使用人工确认的文字设定" /></label><label>场景固定锚点<textarea aria-label="场景固定锚点" value={project.visual.scene} onChange={(event) => store.updateVisual('scene', event.target.value)} placeholder="门窗、家具、光源及轴线方位" /></label></div>
          <div className="image-settings"><div className="section-heading"><h3>参考图片描述</h3><span>{segment?.imageIds.length ?? 0}/6 张用于本段</span></div><div className="image-add"><select aria-label="图片类型" value={imageKind} onChange={(event) => setImageKind(event.target.value as ReferenceImage['kind'])}><option value="character">人物</option><option value="scene">场景</option><option value="prop">道具</option></select><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择参考图片" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.target.value = ''; }} /><button onClick={() => imageInput.current?.click()} disabled={(segment?.imageIds.length ?? 0) >= 6} title="导入图片并生成文字描述"><ImagePlus size={15} />导入图片</button></div><details className="vision-config"><summary>视觉接口配置</summary><label>接口地址<input aria-label="视觉接口地址" value={visionEndpoint} onChange={(event) => setVisionEndpoint(event.target.value)} placeholder="https://…/chat/completions" /></label><label>模型<input aria-label="视觉模型" value={visionModel} onChange={(event) => setVisionModel(event.target.value)} /></label><label>密钥<input aria-label="视觉接口密钥" type="password" autoComplete="off" value={visionKey} onChange={(event) => setVisionKey(event.target.value)} /></label></details>{project.images.map((image) => <div className="image-item" key={image.id}><img src={image.dataUrl} alt={image.name} /><div className="image-detail"><strong>{image.name}</strong><small>{image.kind === 'character' ? '人物' : image.kind === 'scene' ? '场景' : '道具'} · SHA-256 {image.sha256.slice(0, 10)} · v{image.version}</small><label className="image-use"><input type="checkbox" checked={!!segment?.imageIds.includes(image.id)} disabled={!segment || (!!segment && !segment.imageIds.includes(image.id) && segment.imageIds.length >= 6)} onChange={() => segment && store.toggleImage(segment.id, image.id)} />用于本段</label><textarea aria-label={`${image.name}描述`} value={image.description} onChange={(event) => store.updateImage(image.id, event.target.value)} placeholder="等待识图或人工填写可见事实" /><div className="image-actions"><button onClick={() => void generateDescription(image)} disabled={busyImage === image.id}>{busyImage === image.id ? '生成中…' : '生成描述'}</button><button onClick={() => store.confirmImage(image.id)} disabled={image.confirmed || !image.description.trim()}><Check size={14} />{image.confirmed ? '已确认' : '确认描述'}</button></div></div></div>)}<p className="image-note">仅发送压缩图片到所填接口；密钥不存项目。项目快照保存预览、哈希与描述，请另存原图。</p></div>
          {segment && <div className="segment-editor"><div className="section-heading"><h3>{segment.id} <span>{project.scenes.find((item) => item.id === segment.sceneId)?.title}</span></h3><select aria-label="本段模式" value={segment.mode} onChange={(event) => store.setSegmentMode(segment.id, event.target.value as 'dialogue' | 'action')}><option value="dialogue">文戏</option><option value="action">武戏</option></select></div><div className="beat-summary">{segment.beatIds.map((id) => project.beats.find((beat) => beat.id === id)?.text).join(' / ')}</div><div className="shot-tabs">{segment.shots.map((item) => <button key={item.id} className={item.id === shot?.id ? 'active' : ''} onClick={() => store.selectShot(item.id)}>{item.id}<small>{item.duration}s</small></button>)}</div>
            {shot && <div className="shot-editor"><div className="shot-heading"><label>导演意图<input aria-label="导演意图" value={shot.purpose} onChange={(event) => store.updateShot(shot.id, 'purpose', event.target.value)} placeholder="观众在这镜得到什么信息" /></label><label className="duration">时长 <input aria-label="镜头时长" type="number" min="0.1" step="0.5" value={shot.duration} onChange={(event) => store.updateShot(shot.id, 'duration', Number(event.target.value))} />s</label></div><div className="field-grid">{fields.map(({ key, label }, i) => <label key={key}><span>{String.fromCharCode(0x2460 + i)} {label}</span>{key === 'character' || key === 'scene' || key === 'dialogue' ? <div className="readonly-field">{values(project, shot)[i] || '等待确认'}</div> : <textarea aria-label={label} value={shot[key]} onChange={(event) => store.updateShot(shot.id, key as EditableShotKey, event.target.value)} placeholder="待导演确认" />}</label>)}</div></div>}
            <div className="confirm-row"><button onClick={() => store.confirmSegment(segment.id)} disabled={segment.confirmed}><Check size={15} />{segment.confirmed ? '本段已确认' : '确认本段导演决定'}</button></div></div>}
        </section>
        <section className="pane result-pane"><div className="pane-title"><h2>H3 成品与质检</h2><span className={errors.length ? 'error-count' : 'ready-count'}>{errors.length ? `${errors.length} 项阻断` : '可导出'}</span></div><div className="result-tabs"><button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}>本段问题 <span>{visibleIssues.length}</span></button><button className={tab === 'result' ? 'active' : ''} onClick={() => setTab('result')}>分镜预览</button></div>{tab === 'issues' ? <div className="issues">{visibleIssues.map((issue, index) => <div className={`issue ${issue.severity}`} key={index}><AlertCircle size={15} /><div><strong>{issue.segmentId} {issue.shotId}</strong><p>{issue.message}</p></div></div>)}{!visibleIssues.length && <p>本段没有发现问题。</p>}</div> : <pre className="preview">{preview}</pre>}<div className="result-footer"><span>来源与版本信息仅保留在项目快照中。</span><ChevronRight size={16} /></div></section>
      </main>
    </>}
    {message && <div role="status" className="toast" onClick={() => setMessage('')}>{message} ×</div>}
  </div>;
}
