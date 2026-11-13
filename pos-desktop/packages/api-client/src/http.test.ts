import { describe, expect, it } from 'vitest';
import { HttpClient, ApiError } from './http';

function clientReturning(body: string | null, init: ResponseInit = {}) {
  return new HttpClient({
    baseUrl: '/api',
    fetchImpl: async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' }, ...init }),
  });
}

describe('HttpClient response parsing', () => {
  it('rejects a 2xx that is not JSON instead of returning the raw text', async () => {
    // An SPA fallback serving index.html for /api is the real-world case.
    const http = clientReturning('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } });
    await expect(http.get('/users/all')).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });

  it('parses a JSON array', async () => {
    const http = clientReturning('[{"id":"u1"}]');
    await expect(http.get('/users/all')).resolves.toEqual([{ id: 'u1' }]);
  });

  it('returns null for an empty 200 body and undefined for 204', async () => {
    await expect(clientReturning('').get('/x')).resolves.toBeNull();
    await expect(clientReturning(null, { status: 204 }).get('/x')).resolves.toBeUndefined();
  });

  it('keeps the API error code from a JSON error body', async () => {
    const http = clientReturning('{"error":{"code":"NOT_FOUND","message":"nope"}}', { status: 404 });
    await expect(http.get('/x')).rejects.toBeInstanceOf(ApiError);
    await expect(http.get('/x')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
