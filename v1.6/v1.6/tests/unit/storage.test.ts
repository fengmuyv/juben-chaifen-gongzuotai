import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDraft } from '../../src/core/storage';
import { attachImages, detachImages, missingImageKeys } from '../../src/core/image-store';
import { createProject } from '../../src/core/planner';
import { projectSchema, type Project } from '../../src/core/model';

/**
 * 用最小 localStorage 替身把「存档存在但读不出来」这类分支隔离出来。
 * （Node 环境没有 indexedDB，`hasIndexedDb()` 为假，走 localStorage 兜底分支。）
 */
function stubLocalStorage(value: string | null) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'script-storyboard-workbench-draft-v1' ? value : null),
    setItem: () => {},
    removeItem: () => {},
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('loadDraft：必须区分「存档损坏」与「本来就没有存档」', () => {
  it('存档存在但 JSON 解析失败 → 报告 failed，而不是伪装成没有存档', async () => {
    stubLocalStorage('{ 这不是合法 JSON');
    const result = await loadDraft();
    expect(result.project).toBeNull();
    expect(result.failed).toBe(true);
  });

  it('存档存在但结构不属于任何已知版本 → 同样报告 failed', async () => {
    stubLocalStorage(JSON.stringify({ schemaVersion: 99, 无关字段: true }));
    expect((await loadDraft()).failed).toBe(true);
  });

  it('确实没有存档 → 不报 failed（空工作台是正常状态）', async () => {
    stubLocalStorage(null);
    const result = await loadDraft();
    expect(result.project).toBeNull();
    expect(result.failed).toBeUndefined();
  });
});

/**
 * 参考图与主存档分离（2026-10-05）：图片按 sha256 单独存，主 JSON 不再内嵌 dataUrl。
 * 这一层是持久化边界，**拆装必须可逆**，且「装不回去」必须是显式失败而不是坏图。
 */
describe('参考图拆装：可逆，且装不回必须显式失败', () => {
  const DATA_URL = 'data:image/png;base64,AAAA';
  const SHA = 'a'.repeat(64);
  const withImage = (): Project => {
    const project = createProject('# 第一场 室内\n甲：你好。');
    project.assets = [{ id: `img-${SHA}`, sha256: SHA, name: 'a.png', dataUrl: DATA_URL, kind: 'character', description: '', version: 1 }];
    return project;
  };

  it('剥离后主 JSON 不再含图片字节，图片进 blobs', () => {
    const { main, blobs } = detachImages(withImage());
    expect(main).not.toContain(DATA_URL);
    expect(blobs).toEqual([[SHA, DATA_URL]]);
  });

  it('剥离态**单独看是不合法的项目**（空 dataUrl 被 schema 挡住）—— 这正是「装不回不静默」的机制', () => {
    const { main } = detachImages(withImage());
    expect(projectSchema.safeParse(JSON.parse(main)).success).toBe(false);
  });

  it('装回后与原项目等价（dataUrl 完整复原，且能过 schema）', () => {
    const { main, blobs } = detachImages(withImage());
    const restored = projectSchema.parse(attachImages(JSON.parse(main), new Map(blobs)));
    expect(restored.assets[0].dataUrl).toBe(DATA_URL);
  });

  it('图片库缺数据 → 抛错，而不是产出空 dataUrl 的坏图', () => {
    const { main } = detachImages(withImage());
    expect(() => attachImages(JSON.parse(main), new Map())).toThrow('参考图数据缺失');
  });

  it('同一张图在多处引用时只存一份（内容寻址）', () => {
    const project = withImage();
    project.assets.push({ ...project.assets[0], id: 'img-copy' });
    const { blobs } = detachImages(project);
    expect(blobs.length).toBe(1);
  });

  it('旧存档自带 dataUrl（尚未剥离过）→ 不需要图片库也能读，且不用取图', () => {
    const legacy = JSON.parse(JSON.stringify(withImage())) as unknown;
    expect(missingImageKeys(legacy)).toEqual([]);
    expect(projectSchema.safeParse(attachImages(legacy, new Map())).success).toBe(true);
  });
});
