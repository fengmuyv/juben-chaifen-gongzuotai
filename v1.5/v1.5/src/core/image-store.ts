import type { Project } from './model';

/**
 * 参考图与主存档的**拆装**（2026-10-05）。
 *
 * 起因：整个项目（含内嵌参考图 `dataUrl`）被一次性 `JSON.stringify` 后写入 IndexedDB。
 * 大项目下这一步是全量序列化的**绝对大头**（69.8MB 快照实测 250ms），且每次自动保存都要重来一遍 ——
 * 而图片字节几乎从不变化。改为**内容寻址**（key = `image.sha256`，本来就是 schema 里的字段）：
 * 主 JSON 只留除 `dataUrl` 之外的一切，图片单独放、且**只写新增的那些**。
 *
 * 两条设计约束：
 * 1. 剥离态里 `dataUrl` 刻意置**空串**而不是删字段 —— schema 要求它以 `data:image/` 开头，
 *    空串会让「装不回去」在 `migrateProject` 处**显式失败**，而不是悄悄产出一个坏图。
 * 2. 拆装只发生在持久化边界，运行时对象始终带完整 `dataUrl` —— 上层完全无感。
 */

type StoredImage = { sha256?: string; dataUrl?: string };
/**
 * 磁盘形态：新存档把图放在项目级 `assets`；旧存档（尚未搬迁过）放在 `episodes[].images`。
 * 读取侧两种都要认 —— `attachImages` 跑在 `migrateProject` **之前**，此时旧存档还没归一化。
 */
type ImageCarrier = { assets?: StoredImage[]; episodes?: { images?: StoredImage[] }[] };

export type DetachedProject = { main: string; blobs: [string, string][] };

/** 主存档序列化 + 待存图片清单（按 sha256 去重）。 */
export function detachImages(project: Project): DetachedProject {
  const blobs: [string, string][] = [];
  const seen = new Set<string>();
  const assets = project.assets.map((image) => {
    if (image.dataUrl && !seen.has(image.sha256)) { seen.add(image.sha256); blobs.push([image.sha256, image.dataUrl]); }
    return { ...image, dataUrl: '' };
  });
  return { main: JSON.stringify({ ...project, assets }), blobs };
}

/** 需要从图片库里取回的 sha256（旧存档自带 `dataUrl` 的不算）。 */
export function missingImageKeys(raw: unknown): string[] {
  const carrier = raw as ImageCarrier;
  const keys = new Set<string>();
  const collect = (images: StoredImage[] | undefined) => { for (const image of images ?? []) if (!image.dataUrl && image.sha256) keys.add(image.sha256); };
  collect(carrier.assets);
  for (const episode of carrier.episodes ?? []) collect(episode.images);
  return [...keys];
}

/**
 * 把参考图数据装回剥离态存档。
 * 装不回来的**显式抛错** —— 宁可报「读不出来」（界面会提示、且不覆盖原档），也不给一个坏图。
 */
export function attachImages(raw: unknown, blobs: Map<string, string>): unknown {
  const carrier = raw as ImageCarrier;
  const missing: string[] = [];
  const fill = (images: StoredImage[] | undefined) => {
    for (const image of images ?? []) {
      if (image.dataUrl) continue; // 旧存档自带 dataUrl（尚未剥离过），无需装包
      const stored = image.sha256 ? blobs.get(image.sha256) : undefined;
      if (stored) image.dataUrl = stored;
      else missing.push(image.sha256 ?? '(无 sha256)');
    }
  };
  fill(carrier.assets);
  for (const episode of carrier.episodes ?? []) fill(episode.images);
  if (missing.length) throw new Error(`参考图数据缺失（${missing.length} 张）：${missing.slice(0, 3).join(', ')}`);
  return carrier;
}
