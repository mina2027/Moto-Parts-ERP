import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { Session } from '@/types';
import { clearCacheOnSessionChange } from './sessionCache';

const manager = { user: { id: 'manager', branchId: 'b1' }, permissions: ['prices.view_cost'], token: 'old' } as Session;
describe('query cache session scope', () => {
  it('clears privileged data before switching to a cashier', () => {
    const client = new QueryClient();
    client.setQueryData(['products'], { cost: 40 });
    clearCacheOnSessionChange(client, manager, { ...manager, user: { ...manager.user, id: 'cashier' }, permissions: [] });
    expect(client.getQueryData(['products'])).toBeUndefined();
  });
  it('clears when permissions are revoked or the branch changes', () => {
    for (const next of [{ ...manager, permissions: [] }, { ...manager, user: { ...manager.user, branchId: 'b2' } }]) {
      const client = new QueryClient();
      client.setQueryData(['products'], { cost: 40 });
      clearCacheOnSessionChange(client, manager, next);
      expect(client.getQueryData(['products'])).toBeUndefined();
    }
  });
  it('preserves the cache when only the token refreshes', () => {
    const client = new QueryClient();
    client.setQueryData(['products'], { cost: 40 });
    clearCacheOnSessionChange(client, manager, { ...manager, token: 'new' });
    expect(client.getQueryData(['products'])).toEqual({ cost: 40 });
  });
});
