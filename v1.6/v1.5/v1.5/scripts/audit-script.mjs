#!/usr/bin/env node
/**
 * 一键剧本体检入口：`npm run audit:script -- "<剧本路径>"`
 *
 * 只是把剧本路径通过环境变量交给体检用例（`tests/audit/script.audit.test.ts`），
 * 复用产品内置的通用闸门 —— 换剧本不需要改任何代码。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const target = process.argv.slice(2).join(' ').trim();
if (!target) {
  console.error('用法：npm run audit:script -- "<剧本文件路径>"');
  process.exit(2);
}
const file = resolve(target);
if (!existsSync(file) || !statSync(file).isFile()) {
  console.error(`找不到剧本文件：${file}`);
  process.exit(2);
}

const result = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.audit.config.ts'],
  { stdio: 'inherit', shell: true, env: { ...process.env, SCRIPT_FILE: file } },
);
process.exit(result.status ?? 1);
