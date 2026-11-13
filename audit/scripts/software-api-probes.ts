import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

await import('../../erp-backend/src/test/setup.ts');
const { startTestDb, stopTestDb, loginAs } = await import('../../erp-backend/src/test/harness.ts');
const models = await import('../../erp-backend/src/db/models.ts');
const { salesWarehouseFor } = await import('../../erp-backend/src/modules/inventory/stock.ts');
const { default: mongoose } = await import('../../erp-backend/node_modules/mongoose/index.js');
const evidence = path.resolve(import.meta.dirname, '../..', process.argv[2]);
fs.mkdirSync(evidence, { recursive: true });
const results: any[] = [];
let server: any, origin: string, token: string;
async function request(endpoint: string, options: any = {}) {
  const { headers, ...rest } = options;
  const start = performance.now();
  const res = await fetch(origin + '/api' + endpoint, { ...rest, headers: { Authorization: `Bearer ${token}`, ...headers } });
  const text = await res.text();
  return { status: res.status, headers: Object.fromEntries(res.headers), text, durationMs: performance.now() - start };
}
async function check(name: string, action: () => Promise<any>) {
  try { const details = await action(); results.push({ name, status: 'passed', details }); }
  catch (error: any) { results.push({ name, status: 'failed', error: error.stack }); }
  console.log(JSON.stringify(results.at(-1)));
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
}
async function load(count: number, concurrency: number, action: (index: number) => Promise<any>) {
  const samples: any[] = []; let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < count) { const index = next++; samples[index] = await action(index); }
  }));
  const elapsedMs = performance.now() - started;
  const sorted = samples.map(item => item.durationMs).sort((a, b) => a - b);
  return { samples, metrics: { requests: count, concurrency, elapsedMs: Math.round(elapsedMs), requestsPerSecond: Math.round(count * 1000 / elapsedMs * 100) / 100,
    p50Ms: Math.round(sorted[Math.ceil(sorted.length * .50) - 1]), p95Ms: Math.round(sorted[Math.ceil(sorted.length * .95) - 1]), maxMs: Math.round(sorted.at(-1)) } };
}
try {
  const app = await startTestDb({ seed: true });
  assert.equal(mongoose.connection.name, 'moto-test');
  token = (await loginAs(app, 'admin')).token;
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  await check('HTTP authentication, permission and security header boundaries', async () => {
    const missing = await request('/products', { headers: { Authorization: '' } }); assert.equal(missing.status, 401);
    const forged = await request('/products', { headers: { Authorization: 'Bearer invalid.test.signature' } }); assert.equal(forged.status, 401);
    const cashier = await loginAs(app, 'cashier1');
    const forbidden = await request('/reports/accounting', { headers: { Authorization: `Bearer ${cashier.token}` } }); assert.equal(forbidden.status, 403);
    const healthy = await request('/health/live'); assert.equal(healthy.status, 200);
    assert.equal(healthy.headers['x-content-type-options'], 'nosniff');
    assert.equal(healthy.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(healthy.headers['x-powered-by'], undefined);
    assert.match(healthy.headers['content-security-policy'], /default-src 'none'/);
    const untrusted = await request('/health/live', { headers: { Origin: 'https://untrusted.example.invalid' } });
    assert.equal(untrusted.headers['access-control-allow-origin'], undefined);
    return { missingToken: missing.status, forgedToken: forged.status, financialPermission: forbidden.status, csp: healthy.headers['content-security-policy'], foreignOriginResponseStatus: untrusted.status, foreignOriginAllowed: false };
  });
  await check('Malformed JSON, oversized JSON and object-valued login rejected', async () => {
    const malformed = await request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":' }); assert.equal(malformed.status, 400);
    const oversized = await request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'x'.repeat(2 * 1024 * 1024 + 1), password: 'synthetic' }) }); assert.equal(oversized.status, 413);
    const objectLogin = await request('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: { $ne: null }, password: { $ne: null } }) }); assert.equal(objectLogin.status, 400);
    assert.equal((await request('/health/live')).status, 200);
    return { malformedJSON: malformed.status, oversizedJSON: oversized.status, objectValuedLogin: objectLogin.status, processAlive: true };
  });
  await check('300 mixed authenticated reads with 15 simultaneous requests', async () => {
    const routes = ['/products?limit=25&branchId=br-1', '/customers?limit=25&branchId=br-1', '/inventory/levels?branchId=br-1', '/reports/dashboard?branchId=br-1&from=2026-10-01T00:00:00.000Z&to=2026-10-29T00:00:00.000Z'];
    for (const endpoint of routes) { const response = await request(endpoint); assert.equal(response.status, 200, endpoint + ': ' + response.text); }
    const { samples, metrics } = await load(300, 15, index => request(routes[index % routes.length]));
    const statuses = samples.reduce((counts: any, item) => { counts[item.status] = (counts[item.status] ?? 0) + 1; return counts; }, {});
    fs.writeFileSync(path.join(evidence, 'read-latencies.json'), JSON.stringify(samples.map(({ status, durationMs }) => ({ status, durationMs })), null, 2));
    assert.ok(samples.every(item => item.status === 200), JSON.stringify(statuses));
    return { ...metrics, statuses, scope: 'Local development test instance and small seeded catalog; production capacity and production rate limits are not measured.' };
  });
  const warehouseId = await salesWarehouseFor('br-1');
  await models.ProductModel.updateOne({ _id: 'prod-1' }, { $set: { 'prices.retail1': 100 } });
  await models.StockLevelModel.updateOne({ productId: 'prod-1', warehouseId }, { $set: { quantity: 100, reserved: 0 } });
  const body = { branchId: 'br-1', customerId: null, registerSessionId: null, items: [{ productId: 'prod-1', name: { ar: 'اختبار حمل' }, quantity: 1, unitPrice: 100, priceTier: 'retail1' }], payments: [{ method: 'cash', amount: 100 }], type: 'cash' };
  const sale = (key = randomUUID(), payload = body) => request('/sales', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  const stock = async () => (await models.StockLevelModel.findOne({ productId: 'prod-1', warehouseId }).lean())!.quantity;
  await check('25 checkouts with five concurrent writers preserve stock and unique invoice numbers', async () => {
    const before = await models.SaleModel.countDocuments();
    const { samples, metrics } = await load(25, 5, () => sale());
    assert.ok(samples.every(item => item.status === 201), JSON.stringify(samples.filter(item => item.status !== 201)));
    const invoices = samples.map(item => JSON.parse(item.text));
    assert.equal(new Set(invoices.map(item => item.invoiceNumber)).size, 25);
    assert.equal(await stock(), 75); assert.equal(await models.SaleModel.countDocuments() - before, 25);
    assert.equal(invoices.reduce((total, item) => total + item.total, 0), 2500);
    return { ...metrics, createdSales: 25, distinctInvoiceNumbers: 25, remainingStock: 75, totalSalesValue: 2500 };
  });
  await check('Five racing retries create exactly one sale; negative quantities change no records', async () => {
    const before = await models.SaleModel.countDocuments(), stockBefore = await stock(), key = randomUUID();
    const retries = await Promise.all(Array.from({ length: 5 }, () => sale(key)));
    assert.ok(retries.every(item => item.status === 201), JSON.stringify(retries));
    assert.equal(new Set(retries.map(item => JSON.parse(item.text).id)).size, 1);
    assert.equal(await models.SaleModel.countDocuments(), before + 1); assert.equal(await stock(), stockBefore - 1);
    const invalid = await sale(randomUUID(), { ...body, items: [{ ...body.items[0], quantity: -1 }] });
    assert.equal(invalid.status, 400); assert.equal(await stock(), stockBefore - 1);
    assert.equal(await models.SaleModel.countDocuments(), before + 1);
    return { attempts: 5, createdSales: 1, stockReduction: 1, negativeQuantityStatus: invalid.status };
  });
} catch (error: any) { results.push({ name: 'setup', status: 'failed', error: error.stack }); console.error(error); }
finally {
  if (server) await new Promise<void>(resolve => { server.close(resolve); server.closeAllConnections?.(); });
  await stopTestDb();
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  if (results.some(item => item.status === 'failed')) process.exitCode = 1;
}
