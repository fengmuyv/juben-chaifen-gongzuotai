import { migrateProject } from './migrate';
import type { Project } from './model';

/** 整本改造后容量远超 localStorage，持久化迁移至 IndexedDB；不可用时回退 localStorage。 */
const dbName = 'script-storyboard-workbench';
const storeName = 'drafts';
const dbVersion = 1;
const recordKey = 'active-project';
/** v1.0 浏览器草稿键，仅用于一次性迁移读取。 */
export const legacyStorageKey = 'script-storyboard-workbench-draft-v1';
export const autosaveStateKey = 'script-storyboard-workbench-autosave';

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
  });
}

function idbGet(key: string): Promise<string | null> {
  return openDb().then((db) => new Promise<string | null>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'));
    transaction.oncomplete = () => db.close();
  }));
}

function idbPut(key: string, value: string): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 写入失败'));
  }));
}

export type LoadResult = {
  project: Project | null; migrated: boolean; storage: 'indexeddb' | 'localstorage' | 'none';
  /** 存档**存在**但读不出来（解析失败 / 迁移失败）。必须与「本来就没有存档」区分开： */
  /** 若静默按「无存档」处理，用户会以为数据丢了，且继续编辑保存会覆盖掉那份其实还在的原档。 */
  failed?: boolean;
};

/** 启动恢复：优先 IndexedDB，其次迁移 v1 localStorage 草稿。 */
export async function loadDraft(): Promise<LoadResult> {
  /** 记录「确实存在存档但读取失败」，与「从来没有存档」严格区分。 */
  let failed = false;
  const failure = (storage: LoadResult['storage']): LoadResult => ({ project: null, migrated: false, storage, failed });
  if (hasIndexedDb()) {
    try {
      const raw = await idbGet(recordKey);
      if (raw) {
        try {
          const result = migrateProject(JSON.parse(raw));
          if (result.migrated) await idbPut(recordKey, JSON.stringify(result.project));
          return { project: result.project, migrated: result.migrated, storage: 'indexeddb' };
        } catch { failed = true; }
      }
    } catch { /* IndexedDB 本身不可用：继续走 localStorage 兜底，不算「存档损坏」 */ }
  }
  try {
    const legacy = localStorage.getItem(legacyStorageKey);
    if (legacy) {
      try {
        const result = migrateProject(JSON.parse(legacy));
        await saveDraft(result.project);
        return { project: result.project, migrated: true, storage: 'localstorage' };
      } catch { failed = true; }
    }
  } catch { /* localStorage 不可用 */ }
  return failed ? failure('indexeddb') : { project: null, migrated: false, storage: 'none' };
}

export async function saveDraft(project: Project): Promise<'indexeddb' | 'localstorage'> {
  const payload = JSON.stringify(project);
  if (hasIndexedDb()) {
    try { await idbPut(recordKey, payload); return 'indexeddb'; } catch { /* 回退 localStorage */ }
  }
  localStorage.setItem(legacyStorageKey, payload);
  return 'localstorage';
}

export async function clearDraft(): Promise<void> {
  if (hasIndexedDb()) { try { await idbPut(recordKey, ''); } catch { /* 忽略 */ } }
  try { localStorage.removeItem(legacyStorageKey); } catch { /* 忽略 */ }
}
