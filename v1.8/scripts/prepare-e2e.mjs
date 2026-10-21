/**
 * e2e 前置：把上一次遗留的测试产物**移走**（而不是删除）。
 *
 * 起因：Playwright 每次运行都会清空 `outputDir`（默认 `test-results`）。本项目已知
 * **teardown 会挂死**（见 `.workbuddy/memory/环境约束.md`），中断后会留下数百个文件；
 * 下一次运行时的批量删除就会撞上宿主环境的护栏
 * （`[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`）而**直接失败**，表现为「e2e 跑不起来」。
 *
 * 这里改成「移走」：让 Playwright 能重建目录，同时不做任何批量删除。
 * 落点默认取工作区**同级的 `wb_temp`**（非同步区、非 C 盘），可用 `WB_TEMP_DIR` 覆盖。
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const target = join(root, 'test-results');
if (!existsSync(target)) process.exit(0);

const archiveRoot = process.env.WB_TEMP_DIR || join(resolve(root, '..'), 'wb_temp');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const archive = join(archiveRoot, `pw-results-${stamp}`);

try {
  mkdirSync(dirname(archive), { recursive: true });
  renameSync(target, archive);
  console.log(`[e2e] 已把上次残留的 test-results 移走 → ${archive}`);
} catch (error) {
  // 移走失败不拦测试：Playwright 自己会尝试清空，真被护栏拦住时错误信息已经足够明确。
  console.warn(`[e2e] 移走 test-results 失败（继续执行）：${error instanceof Error ? error.message : String(error)}`);
}
