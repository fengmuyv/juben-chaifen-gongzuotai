import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import type { Episode, Project, ReferenceImage } from '../core/model';
import { prepareImage } from '../core/images';
import { samplePixels } from '../core/pixels';
import { analyzeImage, buildLocalDescription, type Roster } from '../core/analyze';
import { buildRoster, subjectRoster } from '../core/match';
import { requestDescription } from '../core/vision';
import { useWorkbench } from '../store';
import { assetKindNames, assetKinds, confidenceNames } from './labels';
import type { ReasoningLevel } from '../../electron/ai-providers';

/** AI 接口参数：资产面板只用它做「AI 生成描述」，不参与生成主路径的就绪判定。 */
type AiFields = { endpoint: string; apiKey: string; effort: ReasoningLevel; model: string };

type Props = {
  project: Project;
  episode: Episode;
  segment: Episode['segments'][number] | undefined;
  assets: ReferenceImage[];
  busy: boolean;
  setBusy(value: boolean): void;
  matchNote: string;
  unassigned: ReferenceImage[];
  lowConfidence: ReferenceImage[];
  ai: AiFields;
  /** 进度面板由 App 持有（生成作业与描述补齐全用同一条），这里只上报与清除。 */
  setProgress(value: { running: boolean; label: string; value: number } | null): void;
  onMessage(message: string): void;
};

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

/**
 * 资产面板 = **两类各一组「下拉 + 已选标签」**（2026-10-06 老大裁定）。
 *
 * 老大原话：「把左边的输入图片改为**下拉选择人物，场景**；**道具选区不要了**」。
 * 于是三框并列（人物 / 场景 / 道具，2026-10-06 上午刚定的 §5.2-3）被推翻：
 *
 * - **选中即绑定**：下拉里点一张 → 立刻加入本段「已选」（标签可逐个删），到 6 张上限为止。
 *   这取代了原先每张卡片上的「用于本段」勾选 —— 选图这件事终于只有**一个**出口。
 * - **描述编辑仍在**，但收成「一张」：点已选标签（或从下拉里选）即把它设为编辑对象，
 *   下方显示缩略图 + 描述框 + 生成描述 / 删除。描述是 ①② 的取值来源（`skeleton.values()`），
 *   砍掉它等于砍掉 ①② 的输入口，故必须留。
 * - **道具整类退役**（连数据层，见 `model.ts` / `migrate.ts`），故 `assetKinds` 只剩两类。
 *
 * 拆壳（P0）说明：导入目标、描述补齐、单张删除都只服务本面板，故连同局部 state 一并下沉到这里；
 * `App.tsx` 只保留项目级 state 与生成作业编排。
 */
export function AssetPane({ project, episode, segment, assets, busy, setBusy, matchNote, unassigned, lowConfidence, ai, setProgress, onMessage }: Props) {
  const store = useWorkbench.getState();
  /**
   * 导入目标分类：由**点的是哪一组的「导入」**决定。两组同时可见，没有「当前分类」这个概念。
   * 文件选择器只有一个、导入代码只有一条 —— 两类共用，不复制入口。
   * 初值 `character` 是历史沿用的缺省：直接给隐藏 input 塞文件（不经「导入」键）时落到人物组。
   */
  const pendingKind = useRef<ReferenceImage['kind']>('character');
  const imageInput = useRef<HTMLInputElement>(null);
  /** 描述编辑对象（资产 id）。**由编排层之上的交互决定**：点已选标签、或从下拉里选一张。 */
  const [editing, setEditing] = useState<string | null>(null);

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
       * 描述由组内的「一键补充描述 / 一键补充 AI 描述」或选中后的编辑区**人工触发**。
       */
      for (const file of list) {
        try { prepared.push(await prepareImage(file, kind)); } catch { failed += 1; }
      }
      const { added, duplicates } = store.addImages(prepared);
      onMessage(`已入库 ${added} 张到${assetKindNames[kind]}（全本资产库，各集共用，不必逐集重复导入）${duplicates ? `，跳过重复 ${duplicates} 张` : ''}${failed ? `，失败 ${failed} 张` : ''}；描述待人工补齐：点「一键补充描述」或选中某张后单独生成`);
    } finally { setBusy(false); }
  }

  async function describeOne(image: ReferenceImage) {
    if (!ai.endpoint.trim() || !ai.model.trim()) { onMessage('请先在接口设置中填写接口地址并选择模型'); return; }
    setBusy(true);
    try {
      const roster: Roster | undefined = subjectRoster(buildRoster(episode));
      // 密钥填了就用填的，留空由主进程回落本机私有配置。
      const result = await requestDescription({ endpoint: ai.endpoint.trim() || undefined, apiKey: ai.apiKey.trim() || undefined, effort: ai.effort, model: ai.model.trim(), image, candidates: roster });
      store.updateImage(image.id, result.description);
      onMessage('图片描述已生成并生效（AI 增强，可随时改写）');
    } catch (error) { onMessage(`图片描述失败：${String(error)}`); }
    finally { setBusy(false); }
  }

  async function describeLocalOne(image: ReferenceImage, overwrite = false) {
    if (image.description.trim() && !overwrite) { onMessage('已有描述，未覆盖；如需重做请先清空描述或使用批量覆盖'); return; }
    try {
      let analysis = image.analysis;
      if (!analysis) {
        const sampled = await samplePixels(image.dataUrl);
        const roster = subjectRoster(buildRoster(episode));
        analysis = analyzeImage({ name: image.name, width: sampled.width, height: sampled.height, pixels: sampled.pixels }, roster);
      }
      // 分析结果随描述一并入库：色卡与图类理由只在补齐后出现，且下次打开仍在（导入阶段不做任何计算）。
      store.updateImage(image.id, buildLocalDescription({ name: image.name, analysis }), analysis);
      onMessage('本地描述已生成并生效（可随时改写）');
    } catch (error) { onMessage(`本地描述失败：${String(error)}`); }
  }

  /** 本类资产的取数口：批量四键一律按 `kind` 收口，避免「组内按键动到别类」。 */
  const assetsOf = (kind: ReferenceImage['kind']) => project.assets.filter((image) => image.kind === kind);

  async function describeLocalMissing(kind: ReferenceImage['kind']) {
    if (busy) return;
    setBusy(true);
    try {
      const targets = assetsOf(kind).filter((image) => !image.description.trim());
      for (const image of targets) await describeLocalOne(image, true);
      onMessage(targets.length ? `已为 ${targets.length} 张${assetKindNames[kind]}资产生成本地描述，已生效` : `没有空白描述的${assetKindNames[kind]}资产`);
    } finally { setBusy(false); }
  }

  /**
   * 补齐 AI 描述：**人工触发**，只处理本类描述为空的资产。
   * 单张失败不中断整批（网络分批失败是常态），末尾统一汇报成功数，未成功的仍是空描述、可重试。
   */
  async function describeAiMissing(kind: ReferenceImage['kind']) {
    if (busy) return;
    if (!ai.endpoint.trim() || !ai.model.trim()) { onMessage('请先在「接口设置」中填写接口地址并选择模型，再补齐 AI 描述'); return; }
    const targets = assetsOf(kind).filter((image) => !image.description.trim());
    if (!targets.length) { onMessage(`没有空白描述的${assetKindNames[kind]}资产（如需重做请先清空描述）`); return; }
    setBusy(true);
    try {
      const roster: Roster | undefined = subjectRoster(buildRoster(episode));
      let done = 0;
      for (const [index, image] of targets.entries()) {
        setProgress({ running: true, label: `AI 描述 ${index + 1}/${targets.length}`, value: (index + 1) / targets.length });
        try {
          const result = await requestDescription({ endpoint: ai.endpoint.trim() || undefined, apiKey: ai.apiKey.trim() || undefined, effort: ai.effort, model: ai.model.trim(), image, candidates: roster });
          store.updateImage(image.id, result.description);
          done += 1;
        } catch { /* 单张失败继续下一张 */ }
      }
      onMessage(done === targets.length ? `已为 ${done} 张${assetKindNames[kind]}资产生成 AI 描述，已生效（可逐张改写）` : `AI 描述完成 ${done}/${targets.length} 张，其余失败；可再点一次重试（已生成的不会被覆盖）`);
    } finally { setProgress(null); setBusy(false); }
  }

  function clearKindDescriptions(kind: ReferenceImage['kind']) {
    const described = assetsOf(kind).filter((image) => !!image.description.trim());
    for (const image of described) store.updateImage(image.id, '');
    onMessage(described.length ? `已清空 ${described.length} 张${assetKindNames[kind]}资产的描述` : `${assetKindNames[kind]}资产当前没有描述内容`);
  }

  /**
   * 清空**本类全部资产**。资产是项目级单源，删一批即全本解除绑定 ——
   * 因此本类有图就先把影响范围（被哪些集绑定）说清楚再确认。
   */
  function clearKindAssets(kind: ReferenceImage['kind']) {
    const list = assetsOf(kind);
    if (!list.length) { onMessage(`${assetKindNames[kind]}当前没有资产`); return; }
    const ids = new Set(list.map((image) => image.id));
    const usedBy = project.episodes.filter((item) => item.segments.some((seg) => seg.imageIds.some((id) => ids.has(id))));
    const detail = usedBy.length ? `已被 ${usedBy.length} 集绑定：${usedBy.map((item) => item.label).join('、')}；删除后这些段的绑定一并解除` : '';
    if (!window.confirm(`清空${assetKindNames[kind]}全部 ${list.length} 张资产？\n${detail ? `${detail}。\n` : ''}删除不可撤销（重新导入同一张图即可恢复）。`)) return;
    for (const image of list) store.removeImage(image.id);
    if (editing && ids.has(editing)) setEditing(null);
    onMessage(`已清空 ${list.length} 张${assetKindNames[kind]}资产，全本绑定一并解除`);
  }

  /**
   * 删除单张资产。资产是项目级单源，删一次即**全本解除绑定** ——
   * 因此只要它被任何集绑定、或已有描述（即存在用户劳动），就先确认并把影响范围说清楚；
   * 纯空白、无人引用的图直接删（不值得为一次误点弹窗）。
   */
  function removeAsset(image: ReferenceImage) {
    const usedBy = project.episodes.filter((item) => item.segments.some((seg) => seg.imageIds.includes(image.id)));
    if (usedBy.length || image.description.trim()) {
      const detail = usedBy.length
        ? `已被 ${usedBy.length} 集绑定：${usedBy.map((item) => item.label).join('、')}；删除后这些段的绑定一并解除`
        : '该资产已有描述';
      if (!window.confirm(`删除资产「${image.name}」？\n${detail}。\n删除不可撤销（重新导入同一张图即可恢复）。`)) return;
    }
    store.removeImage(image.id);
    if (editing === image.id) setEditing(null);
    onMessage(`已删除资产「${image.name}」，全本绑定一并解除`);
  }

  /** 「选一张」的唯一出口：先绑定本段（已达 6 张上限则只提示、不改数据），再把它设为编辑对象。 */
  function pickForSegment(image: ReferenceImage) {
    setEditing(image.id);
    if (!segment) { onMessage('请先在右栏选中一个段落，再选用参考图'); return; }
    if (segment.imageIds.includes(image.id)) return;
    if (!store.toggleImage(segment.id, image.id)) onMessage('本段已绑定 6 张参考图（上限），该图保留在库中标记为已入库未绑定');
  }

  const roster = buildRoster(episode);
  /**
   * 「这张资产是否覆盖了某个需求名」——**按名字对齐**（§5.4 铁律 1：两侧靠人名 / 场景名对齐，不各存实体）。
   * 刻意**不用图像分析结果**：导入不自动分析，「已分析」不能当作供给成立的前提，
   * 否则刚导入的正确图会被报成「缺」。
   */
  const coversKeys = (image: ReferenceImage, keys: string[]) => {
    const stem = image.name.replace(/\.[^.]+$/u, '');
    return keys.some((key) => !!key && (stem.includes(key) || (stem.length >= 2 && key.includes(stem))));
  };
  /** 需求清单（§5.4 通道①）：人物 = 本集说话人名册；场景 = 本集各场标题关键词。 */
  const demandOf = (kind: ReferenceImage['kind']): string[][] =>
    kind === 'character' ? roster.characters.map((name) => [name]) : roster.scenes.map((scene) => scene.keywords);
  /**
   * 每类顶部的需求量文案 —— §5.4 通道① 的界面落点，也是「缺」的显式化（铁律 2：匹配永不静默丢弃）。
   * 两类（人物 / 场景）剧本侧都有名册，故都能报「缺」。
   */
  const supplyOf = (kind: ReferenceImage['kind']) => {
    const list = assetsOf(kind);
    const demand = demandOf(kind);
    if (!demand.length) return `已有 ${list.length} 张`;
    const covered = demand.filter((keys) => keys.length > 0 && list.some((image) => coversKeys(image, keys))).length;
    return `剧本需 ${demand.length} ${kind === 'character' ? '人' : '场'} · 已有 ${covered} · 缺 ${Math.max(0, demand.length - covered)}`;
  };

  /**
   * 描述编辑区：三处信息一次给全 —— 图（缩略图）、来源（分类 / 哈希 / 版本 / 匹配置信度）、
   * 以及**为什么这张图现在没进正文**（空描述时的显式提示，避免「我填了怎么没用」）。
   */
  function renderEditor(image: ReferenceImage) {
    const match = episode.imageMatches[image.id];
    /**
     * 图类提示：`kindGuess` 是**按文件名猜的**，只作提示、**不参与匹配**（匹配按用户导入时所选分类，
     * 见 `match.ts`）。两者不一致时必须说清楚，否则用户不知道自己该信哪个。
     * 猜不出（`null`）时直说「未能判定」，不硬塞一个类目。
     */
    const guess = image.analysis?.kindGuess ?? null;
    const kindHint = image.analysis
      ? (guess === image.kind ? image.analysis.kindReason : guess ? `文件名疑似${assetKindNames[guess]} · 仅提示，匹配按所选分类` : '文件名未能判出图类 · 仅提示，匹配按所选分类')
      : '';
    return <div className="asset-editor" key={image.id}>
      <Thumb dataUrl={image.dataUrl} alt={image.name} />
      <div className="asset-editor-body">
        <strong>{image.name}</strong>
        <small>{assetKindNames[image.kind]} · SHA-256 {image.sha256.slice(0, 10)} · v{image.version}{match ? ` · ${confidenceNames[match.confidence]}置信度` : ''}{kindHint ? ` · ${kindHint}` : ''}</small>
        {image.analysis?.dominant.length ? <div className="palette" aria-label={`${image.name}色卡`}>{image.analysis.dominant.map((color) => <span key={color} title={color} aria-label={color} style={{ backgroundColor: color }} />)}</div> : null}
        <textarea aria-label={`${image.name}描述`} value={image.description} onChange={(event) => store.updateImage(image.id, event.target.value)} placeholder="描述即生效：可点「本地生成描述」/「AI 生成描述」，也可直接人工填写（导入不会自动生成）" />
        <div className="image-actions"><button onClick={() => void describeLocalOne(image)} disabled={busy}>本地生成描述</button><button onClick={() => void describeOne(image)} disabled={busy}>AI 生成描述</button><button onClick={() => removeAsset(image)} disabled={busy}>删除这张资产</button></div>
        {!image.description.trim() && <p className="image-note" role="status">未写描述：这张图不会进入 ① ②（填了即生效，无需确认）</p>}
      </div>
    </div>;
  }

  return <section className="pane input-image-pane" aria-label="输入图片"><div className="pane-title"><h2>输入图片</h2><span>{project.assets.length} 张已入库 · 全本共用 · 本段 {segment?.imageIds.length ?? 0}/6</span></div><div className="image-settings">
    <input ref={imageInput} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="选择参考图片" onChange={(event) => { if (event.target.files?.length) void pickImages(event.target.files, pendingKind.current); event.target.value = ''; }} />
    {matchNote && <p className="match-note">{matchNote}</p>}
    {(lowConfidence.length > 0 || unassigned.length > 0) && <div className="unassigned-zone"><strong>未分配区</strong>{unassigned.map((image) => <span key={image.id} className={`chip ${episode.imageMatches[image.id]?.confidence ?? 'low'}`}>{image.name}<em>{confidenceNames[episode.imageMatches[image.id]?.confidence ?? 'low']}置信度</em></span>)}{!unassigned.length && lowConfidence.map((image) => <span key={image.id} className="chip low">{image.name}<em>低置信度</em></span>)}</div>}
    {assetKinds.map((kind) => {
      const list = assetsOf(kind);
      const described = list.filter((image) => !!image.description.trim()).length;
      const name = assetKindNames[kind];
      const bound = list.filter((image) => !!segment?.imageIds.includes(image.id));
      const editingImage = list.find((image) => image.id === editing);
      return <section className="asset-picker" key={kind} aria-label={`${name}资产`}>
        <div className="asset-picker-head">
          <strong>{name}</strong>
          <span className="asset-picker-need" title="剧本侧需求 vs 资产侧供给，按人名 / 场景名对齐">{supplyOf(kind)}</span>
          <span className="asset-picker-count">{list.length} 张{described ? ` · 有描述 ${described}` : ''}</span>
        </div>
        <div className="asset-picker-row">
          <select aria-label={`选择${name}参考图`} value="" disabled={!segment || busy} onChange={(event) => { const picked = list.find((image) => image.id === event.target.value); if (picked) pickForSegment(picked); }}>
            <option value="">{bound.length ? `— 再选一张${name}（本段已选 ${bound.length}）—` : `— 选择${name}参考图 —`}</option>
            {list.map((image) => <option key={image.id} value={image.id}>{image.name}{image.description.trim() ? '' : '（未写描述）'}</option>)}
          </select>
          <button aria-label={`导入${name}`} onClick={() => openImagePicker(kind)} disabled={busy} title={`导入到${name}（不设数量上限）`}><ImagePlus size={14} />导入</button>
        </div>
        <div className="asset-picker-chosen" role="group" aria-label={`本段已选${name}`}>
          {bound.length ? bound.map((image) => <span className="chip chosen" key={image.id}>
            <button className="chip-pick" onClick={() => setEditing(image.id)} title={`在下方编辑「${image.name}」的描述`}>{image.name}{image.description.trim() ? '' : '（未写描述）'}</button>
            <button className="chip-drop" aria-label={`从本段移除${image.name}`} title="只解除本段的绑定，资产仍在库中" onClick={() => { if (segment) store.toggleImage(segment.id, image.id); }}>×</button>
          </span>) : <span className="asset-picker-none">本段尚未选用{name}参考图</span>}
        </div>
        {editingImage ? renderEditor(editingImage) : list.length ? <p className="asset-picker-hint">点上方已选标签、或从下拉里选一张，即可在这里编辑它的描述。</p> : <p className="asset-picker-empty">暂无{name}资产</p>}
        <div className="asset-picker-actions">
          <button onClick={() => void describeLocalMissing(kind)} disabled={busy || !list.length} title="只为本类描述为空的资产生成本地描述（文件名 + 主色卡，零 API）">一键补充描述</button>
          <button onClick={() => void describeAiMissing(kind)} disabled={busy || !list.length} title="只为本类描述为空的资产调用视觉模型生成描述（需先在接口设置中配置地址与模型）">一键补充 AI 描述</button>
          <button onClick={() => clearKindDescriptions(kind)} disabled={!described} title={`清空本类${name}资产的全部描述，保留图片和分析数据`}>清空描述</button>
          <button onClick={() => clearKindAssets(kind)} disabled={busy || !list.length} title={`删除本类全部${name}资产（不可撤销）`}>清空本类全部资产</button>
        </div>
      </section>;
    })}
  </div></section>;
}
