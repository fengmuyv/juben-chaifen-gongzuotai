import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * 左栏可折叠段（P4 定稿 · 2026-10-06 老大定）：默认收起，行右显示摘要。
 *
 * 三条设计约束：
 * 1. **受控**（`open` / `onToggle` 由编排层持有）——「分集核对清单」的整本解析被
 *    `useMemo` 门在展开态上（`splitEpisodes` 大剧本一次数百毫秒），开关若落在本组件内，
 *    那个 memo 就没了依据，整本解析会重新回到启动路径上。
 * 2. **折叠即卸载**（`open && children`）—— 与 SourcePane 既有纪律一致：折叠态既不渲染 DOM、
 *    也不做整本解析。代价是折叠时内容组件的局部状态会重置，故调用方需把「会被重置的东西」显式化
 *    （如原剧本编辑区的「未保存」标记由 `dirty` 上抛给摘要行，见 `SourcePane.onDirtyChange`）。
 * 3. 用 `button` + `aria-expanded` 而不是 `<details>`：`<details>` 的 open 属性无法受控，
 *    且摘要行要承载按钮样式。
 *
 * `data-section` 供 e2e 精确定位：左栏里含「资产」二字的按钮不止一个
 * （「清空本类全部资产」×3），按无障碍名取会命中多个。
 */
export function Section({ name, summary, open, onToggle, children }: {
  name: string;
  summary: string;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return <section className="rail-section" aria-label={name}>
    <button className="rail-section-head" data-section={name} aria-expanded={open} onClick={onToggle} title={`${name} —— ${summary}`}>
      <ChevronRight size={14} className={open ? 'open' : ''} />
      <strong>{name}</strong>
      <span className="rail-section-summary">{summary}</span>
    </button>
    {open && <div className="rail-section-body">{children}</div>}
  </section>;
}
