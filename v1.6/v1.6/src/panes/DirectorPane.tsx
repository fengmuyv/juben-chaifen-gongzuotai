import { useEffect, useRef } from 'react';
import { isSegmentGenerated, type Episode, type Shot } from '../core/model';
import { segmentDuration } from '../core/timing';
import { fields, type EditableShotKey } from '../platforms/minimax-h3/skeleton';
import { useWorkbench } from '../store';
import { modeNames, sourceNames } from './labels';

type Props = {
  episode: Episode;
  segment: Episode['segments'][number] | undefined;
  /**
   * 当前镜 id。整 P 铺开后它**不再决定显示哪一镜**（全部镜同时可见），只用于两件事：
   * 高亮选中卡、以及「全书清单」跳转后把那一卡滚入视口。
   */
  selectedShot: string | null;
  /**
   * 本段**逐镜**的 14 格取值（key = 镜 id）。
   * 由 App 用 `skeleton.values(project, shot)` 按**镜头对象引用**算好 ——
   * 镜头编号（SC01）跨集重复，不能按 id 全局定位，故取值一律由编排层算。
   */
  shotValues: Map<string, string[]>;
  /** 仅用于「重新生成本 P」的提示文案（两种引擎的说明不同）。 */
  aiReady: boolean;
  busy: boolean;
  /** 重新生成本 P：只重跑本段的 ③–⑭；走本地规则还是 AI 依次推理由编排层判定。 */
  onRegenerate(segmentId: string): void;
  /** 片段导出格式：Word / TXT 二选一。值留在编排层（与顶栏「覆盖已有内容」同类）。 */
  segmentExportFormat: 'word' | 'txt';
  onSegmentExportFormat(format: 'word' | 'txt'): void;
  /** 导出当前片段：只导这一个 P。闸门只认本段 ＋ 集级事实类 error，见编排层 `exportSegment`。 */
  onExportSegment(segmentId: string, format: 'word' | 'txt'): void;
};

/**
 * 导演板 = **P 索引条 + 审阅台**。
 *
 * P4 第二小步 b（2026-10-06 定稿）把审阅台由「镜页签 + 单镜编辑器」改为**整 P 铺开**：
 * P ≡ 15 秒一段（`planner.ts` 本就以 `P01`… 命名段），选中某 P 后该 P 的全部 SC **一次铺开**，
 * 每 SC 一卡，卡头 `SC01【导演意图｜4s】` —— 与 `compiler.previewText` 的标题行**同源**
 * （`${shot.id}【${shot.purpose || '待确认'}｜${shot.duration}s】`），不新造字段。
 *
 * 14 格骨架的**编号、顺序、标签一律不改**（① 人物 … ⑭ 衔接）。三个只读位与 `protectedKeys`
 * 一一对应，卡片上各标来源：① ② 来自资产描述（标「资产」）、⑫ 来自原稿（标「原稿」）；
 * 其余 ③–⑭ 就地改写，改过即以 `draftSource: 'manual'` 标记（标记由 `store.updateShot` 负责）。
 */
export function DirectorPane({ episode, segment, selectedShot, shotValues, aiReady, busy, onRegenerate, segmentExportFormat, onSegmentExportFormat, onExportSegment }: Props) {
  const store = useWorkbench.getState();
  /**
   * 滚动定位。**只服务「全书清单」的跳转**，并守住两条边界 ——
   * 2026-10-06 实测缺陷：初始加载时 `.director-pane` 的 `scrollTop` 竟为 **281**、
   * P 索引条 `boundingBox.y = -35.7`（被顶出视口），用户一打开只看到某张卡的中段。
   * 成因是卡片极高（实测 **1104px**）而可视区仅 **585px**，`scrollIntoView` 于元素高于视口时
   * 会大幅滚动，且切段必然伴随 `selectedShot` 变到该段首镜，无法靠「镜是否变」区分意图。
   *
   * 故规则按**段是否变**优先：
   * ① 段变（含首次挂载后的选中对齐）→ **不滚**，让用户看到 P 索引条与段头；
   * ② 同段内镜变（「全书清单」跳转）→ 把那一卡滚入视口。
   * `?.` 是必要的：jsdom 未实现 `scrollIntoView` / `scrollTo`，无头渲染下直接调用会抛错。
   */
  const pane = useRef<HTMLElement | null>(null);
  const selectedCard = useRef<HTMLElement | null>(null);
  const previous = useRef<{ segment?: string; shot?: string | null }>({ segment: segment?.id, shot: selectedShot });
  useEffect(() => {
    const before = previous.current;
    previous.current = { segment: segment?.id, shot: selectedShot };
    // ① 换段：停在段头，而不是沿用上一个 P 的滚动位置（那会看到新段的中段）。
    if (before.segment !== segment?.id) { pane.current?.scrollTo?.({ top: 0 }); return; }
    // ② 首次挂载：两者都未变 —— 什么都不做，页面天然停在段头。
    if (before.shot === selectedShot) return;
    selectedCard.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedShot, segment?.id]);

  return <section className="pane director-pane" ref={pane}>
    <div className="pane-title"><h2>导演板</h2><span>{episode.segments.length} 段 · 文{episode.segments.filter((item) => item.mode === 'dialogue').length} / 武{episode.segments.filter((item) => item.mode === 'action').length} · 已生成 {episode.segments.filter(isSegmentGenerated).length}/{episode.segments.length}</span></div>
    {/**
      * P 索引条：P ≡ 15 秒一段，选中 P → 审阅台铺开该 P 的全部 SC。
      * 类名仍是 `.segment-strip`（P0 拆壳时的名字）—— **它现在就是这个索引条**，
      * 改名只会让既有定位全面失效而换不来任何信息。
      */}
    <div className="segment-strip" role="group" aria-label="P 索引条">{episode.segments.map((item) => <button key={item.id} className={item.id === segment?.id ? 'selected' : ''} title={`${item.id} · ${modeNames[item.mode]} · 15 秒 · ${item.shots.length} 镜${isSegmentGenerated(item) ? ' · 已生成' : ''}`} onClick={() => store.selectSegment(item.id)}><strong>{item.id}</strong><small>{modeNames[item.mode]} · 15s</small>{isSegmentGenerated(item) && <em className="gen-tag">已生成</em>}{!item.confirmed && <span className="dot" />}</button>)}</div>
    <div className="mode-note">综合模式按剧情节拍逐段选文/武，不固定段数配比。</div>
    {segment && <div className="segment-editor">
      <div className="section-heading"><h3>{segment.id} <span>{episode.scenes.find((item) => item.id === segment.sceneId)?.title}</span></h3><div className="segment-actions"><span className="segment-total">本段各镜合计 {segmentDuration} 秒</span><select aria-label="本段模式" value={segment.mode} onChange={(event) => store.setSegmentMode(segment.id, event.target.value as 'dialogue' | 'action')}><option value="dialogue">文戏</option><option value="action">武戏</option></select><button className="regen" onClick={() => onRegenerate(segment.id)} disabled={busy} title={aiReady ? '只重跑本 P 的 ③–⑭（AI 依次推理，单段失败回退本地规则）；未勾选顶栏「覆盖已有内容」时只补空白' : '只重跑本 P 的 ③–⑭（本地规则）；未勾选顶栏「覆盖已有内容」时只补空白'}>重新生成本 P</button><select aria-label="片段导出格式" value={segmentExportFormat} onChange={(event) => onSegmentExportFormat(event.target.value as 'word' | 'txt')}><option value="word">Word</option><option value="txt">TXT</option></select><button className="segment-export" onClick={() => onExportSegment(segment.id, segmentExportFormat)} disabled={busy} title={`只导出 ${segment.id} 这一片：不补齐整集、不把其他段标记为已生成；闸门只认本段与集级事实类阻断`}>导出当前片段</button></div></div>
      <div className="beat-summary">{segment.beatIds.map((id) => episode.beats.find((beat) => beat.id === id)?.text).join(' / ')}</div>
      <div className="shot-cards">{segment.shots.map((item) => <ShotCard key={item.id} shot={item} values={shotValues.get(item.id) ?? []} selected={item.id === selectedShot} cardRef={(node) => { if (item.id === selectedShot) selectedCard.current = node; }} />)}</div>
    </div>}
  </section>;
}

/**
 * 只读位的来源标：与 `protectedKeys`（character / scene / dialogue）**一一对应**。
 * 把来源写在格子上，用户才不会以为「这格我填不了是坏了」。
 */
const originOf: Record<string, string> = { character: '资产', scene: '资产', dialogue: '原稿' };

/** 单张 SC 卡：卡头是标题行（镜号 + 导演意图 + 时长），下面是 14 格竖排骨架。 */
function ShotCard({ shot, values, selected, cardRef }: {
  shot: Shot;
  /** 该镜的 14 格取值，顺序与 `fields` 一致。 */
  values: string[];
  selected: boolean;
  cardRef(node: HTMLElement | null): void;
}) {
  const store = useWorkbench.getState();
  return <article className={`shot-card${selected ? ' selected' : ''}`} data-shot={shot.id} ref={cardRef}>
    <header className="shot-card-head">
      <strong className="shot-card-title">{shot.id}【{shot.purpose || '待确认'}｜{shot.duration}s】</strong>
      {/**
        * 来源标：local / ai / manual 三态由 `draftSource` 决定，`manual` 即「改过」。
        * 导演意图（`purpose`）是只读派生位，只出现在卡头，不再另设输入框 ——
        * 一是它与标题行同源，二是整 P 铺开后同名输入框会有多个。
        */}
      {shot.draftSource && <span className={`source-tag ${shot.draftSource}`}>来源：{sourceNames[shot.draftSource]}</span>}
    </header>
    <div className="field-grid">{fields.map(({ key, label }, i) => <label key={key}>
      <span>{String.fromCharCode(0x2460 + i)} {label}{originOf[key] && <em className={key === 'dialogue' ? 'origin-tag source' : 'origin-tag'}>{originOf[key]}</em>}</span>
      {key === 'character' || key === 'scene' || key === 'dialogue'
        ? <div className="readonly-field">{values[i] || '未提供（填了描述即自动写入）'}</div>
        : <textarea aria-label={label} value={shot[key]} onChange={(event) => store.updateShot(shot.id, key as EditableShotKey, event.target.value)} placeholder="待导演确认" />}
    </label>)}</div>
  </article>;
}
