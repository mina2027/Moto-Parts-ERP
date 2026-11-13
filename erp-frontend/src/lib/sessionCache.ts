import type { QueryClient } from '@tanstack/react-query';
import type { Session } from '@/types';

const scope = (session: Session | null) => session ? JSON.stringify([session.user.id, session.user.branchId, [...session.permissions].sort()]) : '';
export function clearCacheOnSessionChange(client: QueryClient, previous: Session | null, next: Session | null) {
  if (scope(previous) !== scope(next)) client.clear();
}
