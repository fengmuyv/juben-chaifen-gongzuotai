import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDraft } from '../../src/core/storage';

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
