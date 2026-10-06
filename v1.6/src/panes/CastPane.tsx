import { Check } from 'lucide-react';
import { castNamesOf, type Project } from '../core/model';
import { useWorkbench } from '../store';

type Props = { project: Project };

/**
 * 「人物设定与弧光」（**仅 AI 引擎显示** · 2026-10-06 老大裁定「严格按图 1」）。**本节装两样东西**：
 *
 * ① **按人物**的「人物设定 / 人物弧光」（2026-10-06 老大原话：「人物弧光界面只检测资产的
 *    人物名称并有相应的填写人物设定和人物弧光的文本框」）——
 *    人物列表来自 `castNamesOf(project.assets)`（已上传的**人物资产**文件名去扩展名），
 *    **只读派生**，界面不提供增删人物（要改名字就改资产文件名）。全本一份、不随集切换。
 *    **本轮只落盘**：文本存在 `visual.cast` 里，暂不接进生成链路（要不要供 AI 推理，待下一轮裁定）。
 * ② **固定锚点**（人物 / 场景一段文字 + 人工确认）—— 老大 2026-10-06 明确「锚点保留在本节内」，
 *    故它原样留在这里。它写 `project.visual.{character,scene,confirmed}`，是**项目级**数据，
 *    **数据侧两侧都在消费**（`skeleton.values()` 在无资产描述时把它作为 ①② 的文字兜底；
 *    `validator` 的 `VISUAL_UNCONFIRMED` 与相邻段锚点漂移比对也取它）。
 *
 * 因此锚点这部分在本地模式下**只是不提供录入入口**，而不是「本地不消费」——
 * 已有锚点的老项目切到本地模式仍照常生效，不做任何数据侧收口
 * （删 `values()` 的回落会让老存档导出产物里的 ①② 一起变空，那是拿老数据降级换新界面）。
 */
export function CastPane({ project }: Props) {
  const store = useWorkbench.getState();
  /** 已确认、或两个锚点任一为空 → 不可再点（与原导演板里的判据逐字一致）。 */
  const confirmDisabled = project.visual.confirmed || !project.visual.character.trim() || !project.visual.scene.trim();
  const names = castNamesOf(project.assets);
  const noteOf = (name: string) => project.visual.cast.find((item) => item.name === name);
  return <div className="cast-pane">
    <div className="section-heading">
      <h3>人物设定与弧光 <span>{names.length} 人</span></h3>
    </div>
    <p className="cast-note" role="status">人物列表取自「资产」段已导入的<strong>人物</strong>参考图文件名（去扩展名）；要改名字就改资产文件名。当前只落盘，暂不参与生成。</p>
    {names.length
      ? names.map((name) => {
        const note = noteOf(name);
        return <section className="cast-card" key={name}>
          <strong className="cast-name">{name}</strong>
          <label>人物设定<textarea aria-label={`${name}人物设定`} value={note?.setting ?? ''} onChange={(event) => store.updateCastNote(name, 'setting', event.target.value)} placeholder="身份、年龄、外貌、服装、性格底色；可写变化前后" /></label>
          <label>人物弧光<textarea aria-label={`${name}人物弧光`} value={note?.arc ?? ''} onChange={(event) => store.updateCastNote(name, 'arc', event.target.value)} placeholder="从何处到何处：起点状态 → 转折事件 → 终点状态" /></label>
        </section>;
      })
      : <p className="cast-empty" role="status">还没有人物资产：先在「资产」段导入人物参考图，这里会自动按文件名列出人物。</p>}
    <div className="section-heading cast-anchor-head">
      <h3>视觉文字设定 <span>v{project.visual.version}</span></h3>
      <button onClick={() => store.confirmVisual()} disabled={confirmDisabled}><Check size={15} />{project.visual.confirmed ? '已确认' : '确认设定'}</button>
    </div>
    <p className="cast-note" role="status">此项供 AI 推理使用；本地规则的 ① ② 在无资产描述时也会取它作文字兜底，读的是同一份数据。</p>
    <label>人物固定锚点<textarea aria-label="人物固定锚点" value={project.visual.character} onChange={(event) => store.updateVisual('character', event.target.value)} placeholder="面部特征、发型、服装；缺图时使用人工确认的文字设定" /></label>
    <label>场景固定锚点<textarea aria-label="场景固定锚点" value={project.visual.scene} onChange={(event) => store.updateVisual('scene', event.target.value)} placeholder="门窗、家具、光源及轴线方位" /></label>
  </div>;
}
