import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createProject } from '../../src/core/planner';
import { readWord } from '../../src/core/word';
import { generateEpisodeDrafts, projectCast } from '../../src/platforms/minimax-h3/director';
import { auditEpisodeContent } from '../../src/platforms/minimax-h3/audit';
import { issuePolicy, type IssueCode } from '../../src/platforms/minimax-h3/rules';

/**
 * 任意剧本「正文 × 剧本」一致性体检。
 *
 * 用法：`npm run audit:script -- "E:/路径/剧本.docx"`
 * 判据全部来自产品内置的通用闸门（`audit.ts`），**不针对任何具体剧本调参**。
 * 换剧本只需换路径，不需要改代码。
 */

const FILE = process.env.SCRIPT_FILE?.trim() ?? '';

/** ZIP 魔数 `PK` 即 docx 载荷（用户惯于把 docx 改名成 .txt），其余按 UTF-8 文本读。 */
async function loadText(path: string): Promise<string> {
  const bytes = new Uint8Array(await readFile(path));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const magic = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 2));
  if (magic === 'PK' || /\.docx?$/iu.test(path)) return readWord(buffer);
  return new TextDecoder('utf-8').decode(bytes);
}

describe('任意剧本一致性体检', () => {
  it('runs the built-in cross-checks against one script file', async () => {
    expect(FILE, '用法：npm run audit:script -- "<剧本文件路径>"').not.toBe('');
    const text = await loadText(FILE);
    const project = createProject(text, basename(FILE));
    const cast = projectCast(project);

    let shots = 0;
    const counts = new Map<IssueCode, number>();
    const samples: string[] = [];
    let blocking = 0;

    for (const episode of project.episodes) {
      // 先按规则导演生成整集，再审计 —— 与工作台内「一键生成 → 质检」同一条链路。
      const drafts = generateEpisodeDrafts(project, episode);
      for (const list of drafts.values()) {
        for (const draft of list) {
          const shot = episode.segments.flatMap((segment) => segment.shots).find((item) => item.id === draft.shotId);
          if (!shot) continue;
          for (const [key, value] of Object.entries(draft.fields)) (shot as unknown as Record<string, string>)[key] = value ?? '';
        }
      }
      shots += episode.segments.reduce((sum, segment) => sum + segment.shots.length, 0);
      for (const issue of auditEpisodeContent(project, episode)) {
        counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
        if (issuePolicy[issue.code].severity === 'error') blocking += 1;
        if (samples.length < 12) samples.push(`${episode.id} ${issue.shotId ?? issue.segmentId ?? ''} ${issue.code}：${issue.message}`);
      }
    }

    const scenes = project.episodes.reduce((sum, episode) => sum + episode.scenes.length, 0);
    const beats = project.episodes.reduce((sum, episode) => sum + episode.beats.length, 0);
    const dialogue = project.episodes.reduce((sum, episode) => sum + episode.segments.flatMap((segment) => segment.shots).flatMap((shot) => shot.dialogue).filter((item) => (item.kind ?? 'dialogue') === 'dialogue').length, 0);

    console.log(`[体检] 剧本：${FILE}`);
    console.log(`[体检] ${project.episodes.length} 集 / ${scenes} 场景 / ${beats} 节拍 / ${dialogue} 台词 / ${shots} 镜 / 名册 ${cast.length} 人`);
    console.log(`[体检] 一致性问题合计 ${[...counts.values()].reduce((a, b) => a + b, 0)}（阻断 ${blocking}）`);
    for (const [code, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[体检]   ${code}（${issuePolicy[code].severity}/${issuePolicy[code].category}）= ${count}`);
    }
    for (const sample of samples) console.log(`[体检]   样本 ${sample}`);

    // 一致性判定为**事实类**：生成链路自洽即应为 0，不为 0 说明生成或人工编辑引入了矛盾。
    expect(blocking, '存在阻断级一致性问题，见上方清单').toBe(0);
  });
});
