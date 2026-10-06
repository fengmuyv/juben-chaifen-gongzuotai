import { migrateProject } from './migrate';
import { attachImages, detachImages, missingImageKeys } from './image-store';
import type { Project } from './model';

/** 整本改造后容量远超 localStorage，持久化迁移至 IndexedDB；不可用时回退 localStorage。 */
const dbName = 'script-storyboard-workbench';
const storeName = 'drafts';
/** 参考图单独存放（内容寻址，key = image.sha256）；拆装规则见 `core/image-store.ts`。 */
const imagesStoreName = 'images';
const dbVersion = 2;
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
      if (!db.objectStoreNames.contains(imagesStoreName)) db.createObjectStore(imagesStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
  });
}

function idbGet(key: string, target = storeName): Promise<string | null> {
  return openDb().then((db) => new Promise<string | null>((resolve, reject) => {
    const transaction = db.transaction(target, 'readonly');
    const request = transaction.objectStore(target).get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'));
    transaction.oncomplete = () => db.close();
  }));
}

function idbPut(key: string, value: string, target = storeName): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(target, 'readwrite');
    transaction.objectStore(target).put(value, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 写入失败'));
  }));
}

/** 读多个键（单事务）：装包参考图时一次取回，避免逐张开事务。 */
function idbGetMany(keys: string[], target: string): Promise<Map<string, string>> {
  return openDb().then((db) => new Promise<Map<string, string>>((resolve, reject) => {
    const transaction = db.transaction(target, 'readonly');
    const objectStore = transaction.objectStore(target);
    const found = new Map<string, string>();
    for (const key of keys) {
      const request = objectStore.get(key);
      request.onsuccess = () => { if (typeof request.result === 'string') found.set(key, request.result); };
    }
    transaction.oncomplete = () => { db.close(); resolve(found); };
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 批量读取失败'));
  }));
}

/** 批量写（单事务）：一次自动保存只写**新增**的图片。 */
function idbPutMany(entries: [string, string][], target: string): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(target, 'readwrite');
    const objectStore = transaction.objectStore(target);
    for (const [key, value] of entries) objectStore.put(value, key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 批量写入失败'));
  }));
}

function idbKeys(target: string): Promise<Set<string>> {
  return openDb().then((db) => new Promise<Set<string>>((resolve, reject) => {
    const transaction = db.transaction(target, 'readonly');
    const request = transaction.objectStore(target).getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result.map((key) => String(key))));
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取键失败'));
    transaction.oncomplete = () => db.close();
  }));
}

function idbClear(target: string): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(target, 'readwrite');
    transaction.objectStore(target).clear();
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 清空失败'));
  }));
}

export type LoadResult = {
  project: Project | null; migrated: boolean; storage: 'indexeddb' | 'localstorage' | 'none';
  /** 存档**存在**但读不出来（解析失败 / 迁移失败 / 参考图数据缺失）。必须与「本来就没有存档」区分开： */
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
          const parsed = JSON.parse(raw);
          const keys = missingImageKeys(parsed);
          const blobs = keys.length ? await idbGetMany(keys, imagesStoreName) : new Map<string, string>();
          const result = migrateProject(attachImages(parsed, blobs));
          /** 迁移（v1→v2）后立刻按当前格式回写：让磁盘上的存档也升级成「主 JSON + 图片库」形态。 */
          if (result.migrated) await saveDraft(result.project);
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
  if (hasIndexedDb()) {
    try {
      const { main, blobs } = detachImages(project);
      /** 只写**新增**的图片：图片字节几乎不变，重复写会让「分离」白做。 */
      const existing = await idbKeys(imagesStoreName);
      const fresh = blobs.filter(([key]) => !existing.has(key));
      if (fresh.length) await idbPutMany(fresh, imagesStoreName);
      /** 顺序固定：先图后主。中途失败最多丢掉主 JSON 的这次更新，绝不会出现「主 JSON 引用了还不存在的图」。 */
      await idbPut(recordKey, main);
      return 'indexeddb';
    } catch { /* 回退 localStorage */ }
  }
  /** localStorage 兜底**不做剥离**：它没有第二个 store 可放图，且 5MB 配额本就撑不起参考图。 */
  localStorage.setItem(legacyStorageKey, JSON.stringify(project));
  return 'localstorage';
}

export async function clearDraft(): Promise<void> {
  if (hasIndexedDb()) {
    try { await idbPut(recordKey, ''); } catch { /* 忽略 */ }
    try { await idbClear(imagesStoreName); } catch { /* 忽略 */ }
  }
  try { localStorage.removeItem(legacyStorageKey); } catch { /* 忽略 */ }
}
