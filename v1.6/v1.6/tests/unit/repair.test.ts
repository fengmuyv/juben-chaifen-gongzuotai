import { describe, expect, it } from 'vitest';
import { createProject } from '../../src/core/planner';
import { repairProject } from '../../src/platforms/minimax-h3/repair';

describe('原稿一致性自动修复', () => {
  it('从原稿重建结构并恢复逐字台词，同时保留导演字段', () => {
    const project = createProject('第01集\n# 第一场 书房\n甲：原台词。\n乙：第二句。');
    const episode = project.episodes[0];
    episode.segments[0].shots[0].dialogue[0].text = '错误台词';
    episode.segments[0].shots[0].purpose = '保留的导演意图';
    episode.segments[0].beatIds = [];
    const result = repairProject(project);
    const shot = result.project.episodes[0].segments[0].shots[0];
    expect(shot.dialogue[0].text).toBe('原台词。');
    expect(shot.purpose).toBe('保留的导演意图');
    expect(result.unresolved).toEqual([]);
    expect(result.repairedEpisodes).toEqual([episode.id]);
  });

  it('重复修复结果稳定', () => {
    const project = createProject('第01集\n# 第一场\n甲：原台词。');
    const first = repairProject(project).project;
    const second = repairProject(first).project;
    expect(second.episodes).toEqual(first.episodes);
  });
});
