import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSessionCache,
  getSessionCached,
  readSessionCache,
  writeSessionCache,
} from './sessionCache';

afterEach(() => clearSessionCache());

describe('session cache', () => {
  it('deduplicates concurrent requests and reuses the resolved value', async () => {
    let resolveRequest!: (value: string) => void;
    const request = () =>
      new Promise<string>((resolve) => {
        resolveRequest = resolve;
      });

    const first = getSessionCached('session', request);
    const second = getSessionCached('session', request);
    expect(first).toBe(second);

    resolveRequest('fresh');
    await expect(first).resolves.toBe('fresh');
    await expect(getSessionCached('session', request)).resolves.toBe('fresh');
  });

  it('does not repopulate the cache with a response from before clear', async () => {
    let resolveRequest!: (value: string) => void;
    const pending = getSessionCached(
      'session',
      () =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    clearSessionCache();
    resolveRequest('stale');
    await expect(pending).resolves.toBe('stale');
    expect(readSessionCache('session')).toBeUndefined();

    writeSessionCache('session', 'current');
    expect(readSessionCache('session')).toBe('current');
  });
});
