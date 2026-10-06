import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../src/core/planner';
import { scheduleValidation } from '../../src/core/asyncValidation';

describe('异步校验调度', () => {
  it('不会在调用当前事件栈同步执行校验', async () => {
    vi.useFakeTimers();
    const promise = scheduleValidation(createProject('甲：测试。'), 20);
    let settled = false;
    void promise.then(() => { settled = true; });
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await promise).toEqual(expect.any(Array));
    vi.useRealTimers();
  });

  it('项目变更时可以取消旧校验任务', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = scheduleValidation(createProject('甲：旧稿。'), 20, controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(30);
    let settled = false;
    void promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.useRealTimers();
  });
});
