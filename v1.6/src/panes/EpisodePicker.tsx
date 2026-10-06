import { activeEpisode, type Project } from '../core/model';

type Props = {
  project: Project;
  pickedEpisodes: string[];
  aiReady: boolean;
  busy: boolean;
  onToggle(episodeId: string, checked: boolean): void;
  onSetPicked(ids: string[]): void;
  onGenerate(episodeIds: string[]): void;
  onClose(): void;
};

/**
 * 选择集生成浮层：勾选集后开跑。默认只勾当前集（补跑一集是高频诉求），要整本就点「全选」。
 * 「生成」按钮带集数，避免误触整本重跑。
 */
export function EpisodePicker({ project, pickedEpisodes, aiReady, busy, onToggle, onSetPicked, onGenerate, onClose }: Props) {
  return <div className="gate-backdrop" onClick={onClose}>
    <div className="gate-panel picker-panel" role="dialog" aria-label="选择要生成的分集" onClick={(event) => event.stopPropagation()}>
      <div className="gate-head">
        <div><h3>选择要生成的分集</h3><p className="settings-note">只处理勾选的集，逐集做图像分析 → 匹配 → 生成，单集失败隔离不阻断其余集。{aiReady ? 'AI 就绪，将逐段依次推理，单段失败回退本地规则。' : '当前为本地规则引擎。'}</p></div>
        <button onClick={onClose}>取消</button>
      </div>
      <div className="picker-tools">
        <button onClick={() => onSetPicked(project.episodes.map((item) => item.id))}>全选</button>
        <button onClick={() => onSetPicked([])} disabled={!pickedEpisodes.length}>全不选</button>
        <button onClick={() => onSetPicked([activeEpisode(project).id])}>只选当前集</button>
        <span className="picker-count">已选 {pickedEpisodes.length}/{project.episodes.length} 集</span>
      </div>
      <div className="gate-scroll"><div className="picker-list">{project.episodes.map((item) => <label key={item.id} className={pickedEpisodes.includes(item.id) ? 'picked' : undefined}>
        <input type="checkbox" aria-label={`分集 ${item.label}`} checked={pickedEpisodes.includes(item.id)} onChange={(event) => onToggle(item.id, event.target.checked)} />
        <span>{item.label}</span><small>{item.segments.length} 段</small>
      </label>)}</div></div>
      <div className="gate-actions">
        <button onClick={() => onSetPicked(project.episodes.map((item) => item.id))}>全选并生成</button>
        <button className="primary" disabled={!pickedEpisodes.length || busy} onClick={() => { const ids = [...pickedEpisodes]; onClose(); void onGenerate(ids); }}>生成选中的 {pickedEpisodes.length} 集</button>
      </div>
    </div>
  </div>;
}
