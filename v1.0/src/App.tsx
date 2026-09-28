import { useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronRight, Download, FileInput, FilePlus2, PanelRight, Play, Save } from 'lucide-react';
import { sample } from './fixtures/sample';
import { activeScript, projectSchema, type DefaultMode } from './core/model';
import { useWorkbench } from './store';
import { fields, values, type EditableShotKey } from './platforms/minimax-h3/skeleton';
import { exportBundle, previewMarkdown } from './platforms/minimax-h3/compiler';
import { validate } from './platforms/minimax-h3/validator';

const modeNames = { dialogue: '文戏', action: '武戏', combined: '综合' };
const typeNames = { 'short-drama': '短剧', 'mid-drama': '中剧', 'long-drama': '长剧', film: '电影' };
function download(name: string, content: string, type: string) {
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
  const issues = useMemo(() => project ? validate(project) : [], [project]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const segment = project?.segments.find((item) => item.id === selectedSegment) ?? project?.segments[0];
  const shot = segment?.shots.find((item) => item.id === selectedShot) ?? segment?.shots[0];
  const visibleIssues = issues.filter((issue) => !issue.segmentId || issue.segmentId === segment?.id);
  const source = project ? activeScript(project) : null;
  const preview = project ? previewMarkdown(project) : '';

  async function openFile() {
    try {
      let file: { path: string; content: string } | null = null;
      if (window.workbench) file = await window.workbench.open();
      else {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.txt,.md,.json';
        file = await new Promise((resolve) => { input.onchange = async () => resolve(input.files?.[0] ? { path: input.files[0].name, content: await input.files[0].text() } : null); input.oncancel = () => resolve(null); input.click(); });
      }
      if (!file) return;
      if (file.path.toLowerCase().endsWith('.json')) store.setProject(projectSchema.parse(JSON.parse(file.content)));
      else store.importScript(file.content, file.path.split(/[\\/]/).at(-1) ?? '导入剧本');
      setDraft(null);
      setMessage('文件已打开');
    } catch (error) { setMessage(`导入失败：${String(error)}`); }
  }
  async function saveProject() {
    if (!project) return;
    const content = JSON.stringify(project, null, 2);
    if (window.workbench) { const path = await window.workbench.saveProject(content); if (path) setMessage(`项目已保存：${path}`); }
    else download(`${project.title}-项目.json`, content, 'application/json');
  }
  async function exportFile() {
    if (!project) return;
    try {
      const result = exportBundle(project);
      if (window.workbench) { const path = await window.workbench.saveExport(result.markdown); if (path) setMessage(`分镜已导出：${path}`); }
      else download(`${project.title}-${project.episode}-H3分镜.md`, result.markdown, 'text/markdown');
    } catch (error) { setTab('issues'); setMessage(String(error)); }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">分</span><div><strong>剧本拆分工作台</strong><small>MINIMAX H3 / 分镜正本</small></div></div>
      <div className="toolbar">
        <button onClick={openFile} title="导入 TXT、Markdown 或项目快照"><FileInput size={17} />导入</button>
        <button onClick={() => { store.importScript(sample, '验收样例'); setDraft(null); setMessage('样例已载入，导演字段等待确认'); }} title="载入验收样例"><FilePlus2 size={17} />样例</button>
        <button onClick={saveProject} disabled={!project} title="保存可恢复的项目快照"><Save size={17} />保存项目</button>
        <button className="primary" onClick={exportFile} disabled={!project || errors.length > 0} title={errors.length ? `有 ${errors.length} 项阻断错误` : '导出 Markdown 分镜'}><Download size={17} />导出分镜</button>
      </div>
    </header>
    {!project ? <main className="empty-workspace"><div className="empty-icon"><PanelRight size={32} /></div><h1>从原剧本开始</h1><p>导入 TXT / Markdown，或打开验收样例。原文保留，拆分结果可逐镜修改。</p><div className="empty-actions"><button className="primary" onClick={openFile}><FileInput size={17} />导入剧本</button><button onClick={() => { store.importScript(sample, '验收样例'); setDraft(null); }}><Play size={17} />打开样例</button></div></main> : <>
      <div className="projectbar"><div><input aria-label="作品名称" value={project.title} onChange={(event) => store.setProject({ ...project, title: event.target.value || '未命名作品' })} /><span className="episode">{project.episode}</span><span className="tag">{typeNames[project.contentType]}</span></div><div className="project-controls"><label>内容类型 <select aria-label="内容类型" value={project.contentType} onChange={(event) => store.setProject({ ...project, contentType: event.target.value as typeof project.contentType })}>{Object.entries(typeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>默认模式 <select aria-label="默认模式" value={project.defaultMode} onChange={(event) => store.setMode(event.target.value as DefaultMode)}>{Object.entries(modeNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><button onClick={() => { if (window.confirm('重新规划将替换所有未另存的导演板编辑。继续？')) store.replan(); }} title="按当前原稿和模式重新拆段">重新规划</button></div></div>
      <main className="workspace">
        <section className="pane source-pane"><div className="pane-title"><h2>原剧本</h2><span>{project.scenes.length} 场 · {project.beats.length} 节拍</span></div><div className="source-meta">{source?.filename} · 版本 {project.activeScriptId}</div><textarea aria-label="原剧本编辑区" value={draft ?? source?.text ?? ''} onChange={(event) => setDraft(event.target.value)} spellCheck={false} /><div className="source-footer"><span>编辑后生成新原稿版本；导演板需重新规划。</span><button disabled={draft === null || draft === source?.text} onClick={() => { if (draft === null) return; store.updateScript(draft); setDraft(null); setMessage('新原稿版本已保存；请重新规划'); }}>保存原稿版本</button></div></section>
        <section className="pane director-pane"><div className="pane-title"><h2>导演板</h2><span>{project.segments.length} 段 · {project.segments.length * 15} 秒</span></div><div className="segment-strip">{project.segments.map((item) => <button key={item.id} className={item.id === segment?.id ? 'selected' : ''} onClick={() => store.selectSegment(item.id)}><strong>{item.id}</strong><small>{modeNames[item.mode]} · 15s</small>{!item.confirmed && <span className="dot" />}</button>)}</div>
          <div className="visual-settings"><div className="section-heading"><h3>视觉文字设定 <span>v{project.visual.version}</span></h3><button onClick={() => store.confirmVisual()} disabled={project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim()}><Check size={15} />{project.visual.confirmed ? '已确认' : '确认设定'}</button></div><label>人物固定锚点<textarea aria-label="人物固定锚点" value={project.visual.character} onChange={(event) => store.updateVisual('character', event.target.value)} placeholder="面部特征、发型、服装；缺图时使用人工确认的文字设定" /></label><label>场景固定锚点<textarea aria-label="场景固定锚点" value={project.visual.scene} onChange={(event) => store.updateVisual('scene', event.target.value)} placeholder="门窗、家具、光源及轴线方位" /></label></div>
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
