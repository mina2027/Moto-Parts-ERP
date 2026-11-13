import { uuid } from '@moto/shared';

type Pending = { fingerprint: string; key: string };
const fallback = new Map<string, Pending>();

/** Keep the operation identity until its response arrives, including after a page reload. */
export async function retryableWrite<T>(scope: string, input: unknown, write: (key: string) => Promise<T>): Promise<T> {
  const storageKey = `moto:pending-write:${scope}`;
  const fingerprint = JSON.stringify(input);
  let pending: Pending | null = fallback.get(storageKey) ?? null;
  if (!pending) {
    try { pending = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null'); } catch { /* Invalid old entry. */ }
  }
  if (!pending || pending.fingerprint !== fingerprint || typeof pending.key !== 'string' || !pending.key) pending = { fingerprint, key: uuid() };
  fallback.set(storageKey, pending);
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch { /* Keep retries working when storage is unavailable. */ }
  const result = await write(pending.key);
  if (fallback.get(storageKey)?.key === pending.key) fallback.delete(storageKey);
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Pending | null;
    if (stored?.key === pending.key) sessionStorage.removeItem(storageKey);
  } catch { /* Storage is unavailable. */ }
  return result;
}
