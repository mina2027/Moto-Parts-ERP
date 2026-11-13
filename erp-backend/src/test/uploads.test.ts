import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Express } from 'express';

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { default: path } = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'moto-audit-uploads-'));
  process.env.UPLOAD_DIR = dir;
  return dir;
});
import { api, loginAs, startTestDb, stopTestDb } from './harness.js';
import { createApp } from '../app.js';
import { CompanyLogoModel } from '../db/models.js';
import { ensureBootstrap } from '../db/bootstrap.js';
import { getSettings, updateSettingsSection } from '../modules/settings/service.js';

let app: Express;
let token: string;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZt8AAAAASUVORK5CYII=', 'base64');
const upload = (body: Buffer, filename: string, contentType: string) => api(app).post('/api/settings/logo').set('Authorization', `Bearer ${token}`).attach('file', body, { filename, contentType });

beforeAll(async () => {
  app = await startTestDb({ seed: true });
  token = (await loginAs(app, 'admin')).token;
});
afterAll(async () => {
  await stopTestDb();
  rmSync(uploadDir, { recursive: true, force: true });
});

it('rejects HTML masquerading as a PNG without storing or changing the logo', async () => {
  const before = (await api(app).get('/api/settings').set('Authorization', `Bearer ${token}`)).body.company.logoUrl;
  const files = readdirSync(uploadDir);
  const count = await CompanyLogoModel.countDocuments();
  const response = await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'logo.html', 'image/png');
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('INVALID_IMAGE');
  expect(readdirSync(uploadDir)).toEqual(files);
  expect(await CompanyLogoModel.countDocuments()).toBe(count);
  expect((await api(app).get('/api/settings').set('Authorization', `Bearer ${token}`)).body.company.logoUrl).toBe(before);
});

it('stores PNG bytes in MongoDB without creating a file, and serves them after recreating the app', async () => {
  const files = readdirSync(uploadDir);
  const response = await upload(png, 'logo.html', 'image/png');
  expect(response.status).toBe(200);
  expect(response.body.url).toMatch(/^\/uploads\/logo-[a-f0-9-]+\.png$/);
  expect(readdirSync(uploadDir)).toEqual(files);
  const filename = response.body.url.slice('/uploads/'.length);
  const stored = await CompanyLogoModel.collection.findOne({ _id: filename });
  expect(stored!.data._bsontype).toBe('Binary');
  expect(Buffer.from(stored!.data.buffer)).toEqual(png);
  expect(stored!.mimeType).toBe('image/png');
  expect((await getSettings()).company.logoUrl).toBe(response.body.url);
  const snapshot = await api(app).get('/api/sync/bootstrap').query({ branchId: 'br-1' }).set('Authorization', `Bearer ${token}`);
  expect(snapshot.status).toBe(200);
  expect(snapshot.body.settings.company.logoUrl).toBe(response.body.url);
  expect(snapshot.body.settings.company).not.toHaveProperty('data');
  const served = await api(createApp()).get(response.body.url);
  expect(served.status).toBe(200);
  expect(served.headers['content-type']).toMatch(/^image\/png/);
  expect(served.headers['cache-control']).toContain('immutable');
  expect(served.body).toEqual(png);
  expect((await api(app).get(response.body.url).set('If-None-Match', served.headers.etag)).status).toBe(304);
});

it('replacing the logo keeps previous URLs available for cached devices', async () => {
  const previous = (await getSettings()).company.logoUrl!;
  const response = await upload(png, 'replacement.png', 'image/png');
  expect(response.status).toBe(200);
  expect(response.body.url).not.toBe(previous);
  expect((await getSettings()).company.logoUrl).toBe(response.body.url);
  expect((await api(app).get(previous)).body).toEqual(png);
});

it('startup migrates the legacy logo once and serves it from MongoDB after its file is removed', async () => {
  const company = (await getSettings()).company;
  const filename = 'logo-legacy.png';
  const file = path.join(uploadDir, filename);
  writeFileSync(file, png);
  try {
    await updateSettingsSection('company', { ...company, logoUrl: `/uploads/${filename}` });
    await ensureBootstrap();
    const stored = await CompanyLogoModel.findById(filename);
    expect(Buffer.from(stored!.data)).toEqual(png);
    expect((await getSettings()).company.logoUrl).toBe(`/uploads/${filename}`);
    rmSync(file);
    await ensureBootstrap();
    expect(await CompanyLogoModel.countDocuments({ _id: filename })).toBe(1);
    expect((await api(app).get(`/uploads/${filename}`)).body).toEqual(png);
  } finally {
    await updateSettingsSection('company', company);
    rmSync(file, { force: true });
  }
});

it('startup skips missing, invalid and unsafe legacy logo files', async () => {
  const company = (await getSettings()).company;
  const filename = 'logo-invalid.png';
  const file = path.join(uploadDir, filename);
  writeFileSync(file, Buffer.from('<html>not an image</html>'));
  const count = await CompanyLogoModel.countDocuments();
  try {
    for (const url of ['/uploads/logo-missing.png', `/uploads/${filename}`, '/uploads/../outside.png']) {
      await updateSettingsSection('company', { ...company, logoUrl: url });
      await ensureBootstrap();
      expect(await CompanyLogoModel.countDocuments()).toBe(count);
    }
    expect((await api(app).get(`/uploads/${filename}`)).status).toBe(404);
  } finally {
    await updateSettingsSection('company', company);
    rmSync(file, { force: true });
  }
});

it('rejects a declared image type that does not match the bytes', async () => {
  const response = await upload(png, 'logo.jpg', 'image/jpeg');
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('INVALID_IMAGE');
});

it('rejects active SVG uploads', async () => {
  const response = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg', 'image/svg+xml');
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('BAD_MIME');
});

it('returns a client error for images larger than the upload limit', async () => {
  const files = readdirSync(uploadDir);
  const response = await upload(Buffer.alloc(2 * 1024 * 1024 + 1), 'large.png', 'image/png');
  expect(response.status).toBe(413);
  expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  expect(readdirSync(uploadDir)).toEqual(files);
});

it('rejects logo uploads without settings permission', async () => {
  const cashier = await loginAs(app, 'cashier1');
  const response = await api(app).post('/api/settings/logo').set('Authorization', `Bearer ${cashier.token}`).attach('file', png, { filename: 'logo.png', contentType: 'image/png' });
  expect(response.status).toBe(403);
});
