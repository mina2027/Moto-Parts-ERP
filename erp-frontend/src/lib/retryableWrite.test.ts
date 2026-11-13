import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { retryableWrite } from './retryableWrite';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('reuses the persisted sale identity after a lost response and page reload', async () => {
  const keys: string[] = [];
  await expect(retryableWrite('lost-sale', { total: 100 }, async key => { keys.push(key); throw new Error('Response lost'); })).rejects.toThrow('Response lost');
  vi.resetModules();
  const reloaded = await import('./retryableWrite');
  await reloaded.retryableWrite('lost-sale', { total: 100 }, async key => { keys.push(key); return 'sale-1'; });
  expect(keys[1]).toBe(keys[0]);
  await reloaded.retryableWrite('lost-sale', { total: 100 }, async key => { keys.push(key); return 'sale-2'; });
  expect(keys[2]).not.toBe(keys[0]);
});

it('does not erase a later pending write when an earlier request completes', async () => {
  let finish!: () => void;
  const earlier = retryableWrite('overlap', { total: 100 }, () => new Promise<void>(resolve => { finish = resolve; }));
  let laterKey = '';
  await expect(retryableWrite('overlap', { total: 200 }, async key => { laterKey = key; throw new Error('Lost'); })).rejects.toThrow();
  finish(); await earlier;
  await retryableWrite('overlap', { total: 200 }, async key => expect(key).toBe(laterKey));
});

it('retains retry identity when browser storage refuses writes', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
  let original = '';
  await expect(retryableWrite('quota-sale', { total: 100 }, async key => { original = key; throw new Error('Lost'); })).rejects.toThrow('Lost');
  await retryableWrite('quota-sale', { total: 100 }, async key => expect(key).toBe(original));
});
