import { describe, expect, it } from 'vitest';
import { RequestCoordinator } from './requestCoordinator';

describe('RequestCoordinator', () => {
  it('cancels the previous request for the same key and replaces it', () => {
    const coordinator = new RequestCoordinator();
    const first = coordinator.begin('courses');
    const second = coordinator.begin('courses');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second.requestId).toBe(1);
    expect(coordinator.isCurrent('courses', second.requestId)).toBe(true);
  });

  it('cancels all active requests and clears current ownership', () => {
    const coordinator = new RequestCoordinator();
    const courses = coordinator.begin('courses');
    const tasks = coordinator.begin('tasks');

    coordinator.cancelAll();

    expect(courses.signal.aborted).toBe(true);
    expect(tasks.signal.aborted).toBe(true);
    expect(coordinator.isCurrent('courses', courses.requestId)).toBe(false);
    expect(coordinator.isCurrent('tasks', tasks.requestId)).toBe(false);
  });
});
