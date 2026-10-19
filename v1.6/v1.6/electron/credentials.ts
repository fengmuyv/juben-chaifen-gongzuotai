import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 本机接口凭据（桌面版专用）
 *
 * 设计前提：密钥属于本机私有信息，**不应出现在界面上、不应进入构建产物**。
 * 因此密钥走一条与渲染层完全隔离的通路：
 *
 *   .env.local 的 `WORKBENCH_API_KEY`（**不带 `VITE_` 前缀**）
 *     → 主进程启动后按需读取，只在内存中传递
 *     → 调用时由主进程直接带在请求头上
 *
 * 关键点：Vite 只会把 `VITE_` 前缀的变量注入浏览器构建产物；本模块读取的是**无前缀**键名，
 * 且读取动作发生在主进程（不经过 Vite），所以密钥既不会进 `dist/`，也不会经 IPC 回流到界面。
 * `credentialsStatus()` 是唯一的对外查询口，**只回是否已配置与公开字段，绝不回传密钥本身**。
 *
 * 本文件不引用 `electron` 运行时，可被单元测试直接导入。
 */

export type LocalCredentials = {
  /** 本机私有密钥；仅供主进程内部使用。 */
  apiKey?: string;
  /** 接口基址（只到 `/v1` 一级）。 */
  endpoint?: string;
  /** 模型名。 */
  model?: string;
};

/** 本机配置的落点：单目录，或一条按序回退的查找链。 */
export type CredentialsDir = string | string[];

/** 对外可见的本机配置状态：密钥退化为一个布尔量。 */
export type CredentialsStatus = {
  configured: boolean;
  endpoint?: string;
  model?: string;
};

/**
 * 解析 .env 语法：跳过空行与 `#` 注释，键值按首个 `=` 切分，两侧去空白，成对引号会被剥掉。
 * 值中**允许**出现 `#`（密钥可能含特殊字符），故不做行内注释剥离。
 */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

/**
 * 从配置文本解析凭据（纯函数，不触碰文件系统）。
 * `WORKBENCH_API_KEY` 是唯一认可的前缀形态；不带前缀意味着 Vite 不会把它注入浏览器产物。
 */
export function credentialsFromText(text: string): LocalCredentials {
  const values = parseEnvFile(text);
  return {
    apiKey: values.WORKBENCH_API_KEY || undefined,
    endpoint: values.WORKBENCH_API_ENDPOINT || values.VITE_WORKBENCH_API_ENDPOINT || undefined,
    model: values.WORKBENCH_API_MODEL || values.VITE_WORKBENCH_API_MODEL || undefined,
  };
}

/** 落点既可能是单个目录（测试与调用点都用单参），也可能是一条查找链（开发根 + 用户数据目录）。 */
function candidateDirs(dir: CredentialsDir): string[] {
  return Array.isArray(dir) ? dir : [dir];
}

/**
 * 读取本机私有配置。文件缺失或不可读时返回空对象 —— 「AI 增强可选」的语义要求这里不抛错，
 * 由调用方在确实需要密钥时给出可读提示。
 *
 * 传数组时按**查找链**逐份读取并做非空合并：某一处只写了地址、另一处写了密钥时两边都能生效。
 * 之所以需要查找链：落点不能绑定 `process.cwd()`（从不同目录启动会漂移，出现「写过一次、重开就没了」）。
 */
export function loadLocalCredentials(dir: CredentialsDir = process.cwd()): LocalCredentials {
  const merged: LocalCredentials = {};
  for (const candidate of candidateDirs(dir)) {
    let text = '';
    try {
      text = readFileSync(join(candidate, '.env.local'), 'utf8');
    } catch {
      continue;
    }
    const parsed = credentialsFromText(text);
    merged.apiKey ??= parsed.apiKey;
    merged.endpoint ??= parsed.endpoint;
    merged.model ??= parsed.model;
  }
  return merged;
}

/** 把凭据压成对外可见的状态：密钥退化成一个布尔量。 */
export function statusFrom(credentials: LocalCredentials): CredentialsStatus {
  return { configured: Boolean(credentials.apiKey), endpoint: credentials.endpoint, model: credentials.model };
}

/** 唯一对外查询口：只暴露「是否已配置」与公开字段，密钥本身不外流。 */
export function credentialsStatus(dir: CredentialsDir = process.cwd()): CredentialsStatus {
  return statusFrom(loadLocalCredentials(dir));
}

/** 取本机密钥；未配置时给出可照做的提示，而不是让请求以 401 结束。 */
export function requireLocalApiKey(dir: CredentialsDir = process.cwd()): string {
  const { apiKey } = loadLocalCredentials(dir);
  if (!apiKey) throw new Error('本机尚未配置接口密钥：请在工程目录的 .env.local 中填写 WORKBENCH_API_KEY');
  return apiKey;
}

/** 本模块独占管理的三个键：写入时只替这三行，其余行一字不动。 */
const managedKeys = ['WORKBENCH_API_KEY', 'WORKBENCH_API_ENDPOINT', 'WORKBENCH_API_MODEL'];
const fileHeader = '# 本机接口凭据 —— 由工作台「接口设置」自动写入（密钥填一次即常驻，无需手动保存）。\n# 该文件已被 .gitignore 忽略（.env*），不会进仓库、不会进构建产物；请勿手工提交。';

/**
 * 把界面填写的凭据写回本机私有配置（`.env.local`）。
 *
 * 写入目标取查找链的**首项**（开发态 = 工程根，打包态 = 用户数据目录），读取仍走完整查找链，
 * 保证「写哪儿、读哪儿」不分裂。
 *
 * 边界：只覆盖 `managedKeys` 三行，用户在这个文件里写的其他变量原样保留；
 * 空串表示「删除该项」（例如清空密钥即从本机撤销）。**不经过渲染层、不进 `dist/`**；
 * 界面拿到的回执依旧是退化成布尔量的 `CredentialsStatus`。
 */
export function saveLocalCredentials(credentials: LocalCredentials, dir: CredentialsDir = process.cwd()): CredentialsStatus {
  const target = candidateDirs(dir)[0];
  let existing = '';
  try {
    existing = readFileSync(join(target, '.env.local'), 'utf8');
  } catch { existing = ''; }
  const kept = existing.split(/\r?\n/u).filter((line) => {
    const key = line.trim().split('=')[0]?.trim();
    return !key || !managedKeys.includes(key);
  });
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const lines: string[] = [];
  if (!kept.length) lines.push(fileHeader, '');
  else lines.push(...kept, '');
  const entries: [string, string | undefined][] = [
    ['WORKBENCH_API_KEY', credentials.apiKey],
    ['WORKBENCH_API_ENDPOINT', credentials.endpoint],
    ['WORKBENCH_API_MODEL', credentials.model],
  ];
  for (const [key, value] of entries) if (value) lines.push(`${key}=${value}`);
  writeFileSync(join(target, '.env.local'), `${lines.join('\n')}\n`, 'utf8');
  return credentialsStatus(dir);
}
