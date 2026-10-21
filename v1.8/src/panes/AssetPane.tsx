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
function Thumb({ dataUrl, alt, margin = '240px' }: { dataUrl: string; alt: string; margin?: string }) {
  const node = useRef<HTMLImageElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = node.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: margin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, margin]);

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
 * - **缩略图条**（2026-10-10 补 · 老大报「上传的图片再打开无法查看」）：每类在「已选标签」下方
 *   常驻一条该类**全部**资产的缩略图。此前缩略图只剩描述编辑区一处，而编辑区由易失的局部
 *   state 控制 —— 导入不设置它、重载必为 `null`，于是导入后与重开后都看不到任何图。
 *   条内点一下 = 复用唯一的选图出口 `pickForSegment`（选为本段 + 打开编辑区），不新增选图语义。
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
  /**
   * 当前显示的资产类别（2026-10-19 老大裁定「合并折叠」）。
   *
   * 原形态 = 人物 / 场景两张卡片纵向并列、同时展开；老大原话：「点击出现人物和场景选项，
   * 选择哪个显示哪一部分的资产」。故两类收进**同一块**面板，由类别下拉切换、一次只渲染一类 ——
   * 纵向占位从两套（下拉 + 已选 + 缩略图条 + 四键）压成一套。**四键仍按类作用**，
   * 破坏范围与改造前完全一致（不因合并而升级为全库操作）。
   *
   * 记忆（2A）：切换只换内容区，各类的编辑对象互不影响、切回原样。这是**会话内**记忆
   * （组件 state），不落盘 —— 重开应用回到人物；要跨启动记住须另加持久化，未经裁定不加。
   */
  const [activeKind, setActiveKind] = useState<ReferenceImage['kind']>('character');
  /** 描述编辑对象，**按类各记一个**：切换类别时不清空，切回来仍是上次那张。 */
  const [editingByKind, setEditingByKind] = useState<Record<ReferenceImage['kind'], string | null>>({ character: null, scene: null });
  const editing = editingByKind[activeKind];
  const setEditingFor = (kind: ReferenceImage['kind'], id: string | null) => setEditingByKind((prev) => ({ ...prev, [kind]: id }));

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
    const editingId = editingByKind[kind];
    if (editingId && ids.has(editingId)) setEditingFor(kind, null);
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
    if (editingByKind[image.kind] === image.id) setEditingFor(image.kind, null);
    onMessage(`已删除资产「${image.name}」，全本绑定一并解除`);
  }

  /** 「选一张」的唯一出口：先绑定本段（已达 6 张上限则只提示、不改数据），再把它设为编辑对象。 */
  function pickForSegment(image: ReferenceImage) {
    setEditingFor(image.kind, image.id);
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
   *
   * **单一来源**：缺口数字由 `supplyStatsOf` 算一次，`supplyOf`（悬停全文）与类别下拉的
   * 选项文案（窄栏短句）都从这一份派生 —— 否则两处各算一次，迟早出现「下拉说缺 1、提示说缺 2」。
   */
  const supplyStatsOf = (kind: ReferenceImage['kind']) => {
    const list = assetsOf(kind);
    const demand = demandOf(kind);
    const covered = demand.filter((keys) => keys.length > 0 && list.some((image) => coversKeys(image, keys))).length;
    return { total: demand.length, covered, missing: Math.max(0, demand.length - covered) };
  };
  const supplyOf = (kind: ReferenceImage['kind']) => {
    if (!demandOf(kind).length) return `已有 ${assetsOf(kind).length} 张`;
    const stats = supplyStatsOf(kind);
    return `剧本需 ${stats.total} ${kind === 'character' ? '人' : '场'} · 已有 ${stats.covered} · 缺 ${stats.missing}`;
  };
  /**
   * 类别下拉的选项文案：窄栏里放得下的短句（全量口径挂在 `title` 上）。
   * 因一次只显示一类，这里必须把「缺」写进选中项本身，否则折叠后缺口就看不见了。
   */
  const kindOptionLabel = (kind: ReferenceImage['kind']) => {
    const name = assetKindNames[kind];
    if (!demandOf(kind).length) return `${name}（已有 ${assetsOf(kind).length} 张）`;
    const stats = supplyStatsOf(kind);
    return `${name}（需 ${stats.total} ${kind === 'character' ? '人' : '场'} · 缺 ${stats.missing}）`;
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

  /**
   * 当前类的派生量，**在渲染前算一次**：合并折叠后一次只渲染一类，
   * 这些量（张数 / 有描述数 / 本段已选 / 编辑对象）都只服务这一块面板。
   */
  const kind = activeKind;
  const kindName = assetKindNames[kind];
  const kindAssets = assetsOf(kind);
  const describedCount = kindAssets.filter((image) => !!image.description.trim()).length;
  const boundAssets = kindAssets.filter((image) => !!segment?.imageIds.includes(image.id));
  const editingImage = kindAssets.find((image) => image.id === editing);

  return <section className="pane input-image-pane" aria-label="输入图片"><div className="pane-title"><h2>输入图片</h2><span>{project.assets.length} 张已入库 · 全本共用 · 本段 {segment?.imageIds.length ?? 0}/6</span></div><div className="image-settings">
    <input ref={imageInput} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="选择参考图片" onChange={(event) => { if (event.target.files?.length) void pickImages(event.target.files, pendingKind.current); event.target.value = ''; }} />
    {matchNote && <p className="match-note">{matchNote}</p>}
    {(lowConfidence.length > 0 || unassigned.length > 0) && <div className="unassigned-zone"><strong>未分配区</strong>{unassigned.map((image) => <span key={image.id} className={`chip ${episode.imageMatches[image.id]?.confidence ?? 'low'}`}>{image.name}<em>{confidenceNames[episode.imageMatches[image.id]?.confidence ?? 'low']}置信度</em></span>)}{!unassigned.length && lowConfidence.map((image) => <span key={image.id} className="chip low">{image.name}<em>低置信度</em></span>)}</div>}
    <section className="asset-picker" aria-label={`${kindName}资产`}>
      {/**
        * 类别下拉（2026-10-19 · 老大裁定「合并折叠」）。
        *
        * 原形态是两类各一张卡、同时展开；现在**只渲染当前类**，由这一个下拉切换。
        * 下拉的选项文案必须自带「缺 N」——因为另一类不在视野里，缺口若只挂在被隐藏的卡片上，
        * 就等于没有提示（这是合并折叠最容易丢的信息，故写进选中项本身，全文挂在 title 上）。
        */}
      <div className="asset-kind-row">
        <label htmlFor="asset-kind">资产类别</label>
        <select id="asset-kind" value={activeKind} title={supplyOf(activeKind)} onChange={(event) => setActiveKind(event.target.value as ReferenceImage['kind'])}>
          {assetKinds.map((item) => <option key={item} value={item} title={supplyOf(item)}>{kindOptionLabel(item)}</option>)}
        </select>
        <span className="asset-picker-count">{kindAssets.length} 张{describedCount ? ` · 有描述 ${describedCount}` : ''}</span>
      </div>
      <div className="asset-picker-row">
        <select aria-label={`选择${kindName}参考图`} value="" disabled={!segment || busy} onChange={(event) => { const picked = kindAssets.find((image) => image.id === event.target.value); if (picked) pickForSegment(picked); }}>
          <option value="">{boundAssets.length ? `— 再选一张${kindName}（本段已选 ${boundAssets.length}）—` : `— 选择${kindName}参考图 —`}</option>
          {kindAssets.map((image) => <option key={image.id} value={image.id}>{image.name}{image.description.trim() ? '' : '（未写描述）'}</option>)}
        </select>
        <button aria-label={`导入${kindName}`} onClick={() => openImagePicker(kind)} disabled={busy} title={`导入到${kindName}（不设数量上限）`}><ImagePlus size={14} />导入</button>
      </div>
      <div className="asset-picker-chosen" role="group" aria-label={`本段已选${kindName}`}>
        {boundAssets.length ? boundAssets.map((image) => <span className="chip chosen" key={image.id}>
          <button className="chip-pick" onClick={() => setEditingFor(kind, image.id)} title={`在下方编辑「${image.name}」的描述`}>{image.name}{image.description.trim() ? '' : '（未写描述）'}</button>
          <button className="chip-drop" aria-label={`从本段移除${image.name}`} title="只解除本段的绑定，资产仍在库中" onClick={() => { if (segment) store.toggleImage(segment.id, image.id); }}>×</button>
        </span>) : <span className="asset-picker-none">本段尚未选用{kindName}参考图</span>}
      </div>
      {/**
        * 资产缩略图条（2026-10-10 · 老大报「上传的图片再打开无法查看」后补）。
        *
        * 原委：改版后全应用只剩**描述编辑区**一处渲染缩略图，而编辑区由组件局部 state `editing`
        * 控制 —— `pickImages` 导入时只入库、**不设置 `editing`**；`editing` 不落盘，重载后必然为 `null`。
        * 于是「刚导入」与「再打开」都看不到任何一张图，只有手动从下拉里选一次才短暂出现；
        * 而下拉的 `<option>` 与已选标签都只能放文字，放不下缩略图（实测三态：导入后 0 张 / 手选后 1 张 / 重载后 0 张）。
        *
        * 这里给每类补一条**始终可见**的缩略图条：该类**全部**资产的小图都在，已绑定本段的加边框高亮。
        * 点一下就复用**唯一的选图出口** `pickForSegment`（选为本段 + 打开编辑区）——
        * 只增加「看得见」这一件事，不新增第二种选图语义。
        * 合并折叠后它随类别切换，故「缩略图是否常驻可见」的判据不变：切到该类就看得见。
        */}
      {kindAssets.length ? <div className="asset-strip" role="group" aria-label={`${kindName}缩略图条`}>
        {kindAssets.map((image) => <button
          key={image.id}
          type="button"
          className={`asset-thumb${segment?.imageIds.includes(image.id) ? ' bound' : ''}${editing === image.id ? ' editing' : ''}`}
          aria-label={`选用${image.name}`}
          title={`${image.name}${image.description.trim() ? '' : '（未写描述）'} · 点一下：加入本段并编辑描述`}
          onClick={() => pickForSegment(image)}
        ><Thumb dataUrl={image.dataUrl} alt={image.name} /><span>{image.name.replace(/\.[^.]+$/u, '')}</span></button>)}
      </div> : null}
      {editingImage ? renderEditor(editingImage) : kindAssets.length ? <p className="asset-picker-hint">点上方已选标签、缩略图条或下拉里的一张，即可在这里编辑它的描述。</p> : <p className="asset-picker-empty">暂无{kindName}资产</p>}
      <div className="asset-picker-actions">
        <button onClick={() => void describeLocalMissing(kind)} disabled={busy || !kindAssets.length} title="只为本类描述为空的资产生成本地描述（文件名 + 主色卡，零 API）">一键补充描述</button>
        <button onClick={() => void describeAiMissing(kind)} disabled={busy || !kindAssets.length} title="只为本类描述为空的资产调用视觉模型生成描述（需先在接口设置中配置地址与模型）">一键补充 AI 描述</button>
        <button onClick={() => clearKindDescriptions(kind)} disabled={!describedCount} title={`清空本类${kindName}资产的全部描述，保留图片和分析数据`}>清空描述</button>
        <button onClick={() => clearKindAssets(kind)} disabled={busy || !kindAssets.length} title={`删除本类全部${kindName}资产（不可撤销）`}>清空本类全部资产</button>
      </div>
    </section>
  </div></section>;
}
