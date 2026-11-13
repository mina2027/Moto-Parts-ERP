import { expect, it } from 'vitest';
import { createApiClient } from './client';
it('preserves the supplied idempotency key across a supplier-payment authentication retry', async () => {
  const requests: RequestInit[] = [];
  const api = createApiClient({
    baseUrl: '/api', getToken: () => 'old-token', onUnauthorized: async () => 'new-token',
    fetchImpl: async (_url, init) => {
      requests.push(init!);
      return requests.length === 1
        ? new Response(JSON.stringify({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }), { status: 401 })
        : new Response(JSON.stringify({ id: 'synthetic-payment' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    },
  });
  expect(await api.purchases.recordPayment({ supplierId: 'sup-1', purchaseId: 'po-1', amount: 10, method: 'cash', reference: '' }, 'audit-stable-key')).toMatchObject({ id: 'synthetic-payment' });
  expect(requests).toHaveLength(2);
  for (const request of requests) expect((request.headers as Record<string, string>)['Idempotency-Key']).toBe('audit-stable-key');
});
