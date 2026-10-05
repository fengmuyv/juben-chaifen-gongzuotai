import { defineConfig } from 'vitest/config';

/**
 * 一次性剧本体检专用配置：只收集 `tests/audit/` 下的用例，
 * 与 `npm test`（`tests/unit/**`）完全隔离 —— 日常单测不受真稿规模影响。
 * 由 `npm run audit:script -- "<剧本路径>"` 触发。
 */
export default defineConfig({ test: { include: ['tests/audit/**/*.test.ts'], testTimeout: 1_800_000, hookTimeout: 1_800_000 } });
