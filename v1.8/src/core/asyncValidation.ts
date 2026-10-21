import type { Issue, Project } from './model';
import { validate } from '../platforms/minimax-h3/validator';

export type ValidationState = 'idle' | 'validating' | 'ready';

/** 防止大剧本编辑时把同步质检压在每个按键事件上；只提交最后一次项目快照。 */
export function scheduleValidation(project: Project | null, delay = 180, signal?: AbortSignal): Promise<Issue[]> {
  if (!project) return Promise.resolve([]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (signal?.aborted) return;
      resolve(validate(project));
    }, delay);
    signal?.addEventListener('abort', () => clearTimeout(timer), { once: true });
  });
}
