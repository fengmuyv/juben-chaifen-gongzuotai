import { activeEpisode, type Project } from '../core/model';
import { auditProject } from '../platforms/minimax-h3/gate';
import { ignorableIssueCategories, issueCategoryNames } from '../platforms/minimax-h3/validator';
import { useWorkbench } from '../store';

type GateAudit = ReturnType<typeof auditProject>;
type GateIssue = GateAudit['errors'][number];

type Props = {
  project: Project;
  gate: GateAudit;
  /**
   * 「本次清单会话内已忽略」的条目集合。**由 App 持有**（不是本面板的局部 state）：
   * 关闭清单只是卸载视图，若把状态放在这里，重开时忽略记录会被静默清空 —— 那是行为变化。
   */
  ignoredGateIssues: Set<string>;
  onAddIgnored(keys: string[]): void;
  onResetIgnored(): void;
  onRepair(episodeId?: string): void;
  onExportFile(episodeId: string): void;
  onExportWord(episodeId: string): void;
  onClose(): void;
};

/** 忽略条目的稳定标识：同一集同一段同一镜同一码同一文案才算同一条。 */
function gateIssueKey(issue: { episodeId: string; code: string; segmentId?: string; shotId?: string; message: string }) {
  return `${issue.episodeId}|${issue.code}|${issue.segmentId ?? ''}|${issue.shotId ?? ''}|${issue.message}`;
}

function isIgnorableGateIssue(issue: { category: keyof typeof issueCategoryNames }) {
  return ignorableIssueCategories.includes(issue.category as typeof ignorableIssueCategories[number]);
}

/**
 * 全书阻断清单：逐条给出集/段/镜与分类，可直接跳转定位；可导出集单列并支持按集导出。
 * 阻断项只含事实类（input / reference / source）与内容安全项，人工确认类一律为复核。
 */
export function GatePanel({ project, gate, ignoredGateIssues, onAddIgnored, onResetIgnored, onRepair, onExportFile, onExportWord, onClose }: Props) {
  const store = useWorkbench.getState();
  return <div className="gate-backdrop" onClick={onClose}>
    <div className="gate-panel" role="dialog" aria-label="全书阻断清单" onClick={(event) => event.stopPropagation()}>
      <div className="gate-head"><div><h3>全书阻断清单</h3><p className="settings-note">阻断项只含事实类问题与内容安全项；可忽略仅在本次清单会话中折叠输入和参考图问题。</p></div><button onClick={onClose}>关闭</button></div>
      <div className="gate-summary">
        <span className={gate.errors.length ? 'error-count' : 'ready-count'}>{gate.errors.length ? `${gate.errors.length - gate.errors.filter((issue) => ignoredGateIssues.has(gateIssueKey(issue))).length} 项未忽略阻断 · ${gate.episodes.filter((item) => item.errors.some((issue) => !ignoredGateIssues.has(gateIssueKey(issue)))).length} 集待处理` : '全书没有阻断项'}</span>
        <span>可导出集 {gate.exportableEpisodes.length}/{gate.episodes.length} · 建议复核 {gate.warnings.length} 项</span>
      </div>
      <div className="gate-scroll"><div className="gate-list">{gate.episodes.filter((item) => item.errors.some((issue) => !ignoredGateIssues.has(gateIssueKey(issue)))).map((item) => <div className="gate-episode" key={item.episodeId}>
        <div className="gate-episode-head"><strong>{item.label}</strong><span>{item.errors.filter((issue) => !ignoredGateIssues.has(gateIssueKey(issue))).length} 项未忽略阻断</span></div>
        {item.errors.filter((issue) => !ignoredGateIssues.has(gateIssueKey(issue))).map((issue: GateIssue, index) => <div className="gate-item" key={`${issue.code}-${issue.segmentId ?? 'ep'}-${issue.shotId ?? index}-${index}`}>
          <span className={`gate-tag ${issue.category}`}>{issueCategoryNames[issue.category]}</span>
          <span className="gate-where">{issue.segmentId ?? '本集'}{issue.shotId ? ` · ${issue.shotId}` : ''}</span>
          <span className="gate-message">{issue.message}</span>
          <button onClick={() => { store.focusTarget(item.episodeId, issue.segmentId, issue.shotId); onClose(); }}>跳转</button>
          {isIgnorableGateIssue(issue) && <button onClick={() => onAddIgnored([gateIssueKey(issue)])}>忽略</button>}
        </div>)}
      </div>)}</div></div>
      {gate.errors.length > 0 && <div className="gate-actions"><button className="primary" onClick={() => onRepair()} title="按原始剧本重建结构与台词，并保留可匹配的导演内容">自动修复全部阻断</button><button onClick={() => onRepair(activeEpisode(project).id)} title="只修复当前集">修复本集</button>{gate.errors.some((issue) => isIgnorableGateIssue(issue) && !ignoredGateIssues.has(gateIssueKey(issue))) && <button onClick={() => onAddIgnored(gate.errors.filter(isIgnorableGateIssue).map(gateIssueKey))}>忽略可忽略阻断</button>}<button onClick={onResetIgnored} disabled={!ignoredGateIssues.size}>恢复已忽略</button></div>}
      {gate.exportableEpisodes.length > 0 && <div className="gate-clean">
        <strong>可直接导出的集（{gate.exportableEpisodes.length}）</strong>
        <p className="settings-note">其他集存在阻断不影响这些集；单集导出不改变当前选中的集。</p>
        <div className="gate-clean-list">{gate.exportableEpisodes.map((item) => <span className="gate-clean-item" key={item.episodeId}>{item.label}<button onClick={() => void onExportFile(item.episodeId)}>导出 TXT</button><button onClick={() => void onExportWord(item.episodeId)}>导出 Word</button></span>)}</div>
      </div>}
    </div>
  </div>;
}
