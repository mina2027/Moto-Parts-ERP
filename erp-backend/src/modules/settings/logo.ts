import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { CompanyLogoModel, SettingsModel } from '../../db/models.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { getSettings, updateSettingsSection } from './service.js';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_FILENAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.(png|jpe?g|webp)$/i;

function logoType(bytes: Buffer): { mime: string; extension: string } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return { mime: 'image/png', extension: '.png' };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: '.jpg' };
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return { mime: 'image/webp', extension: '.webp' };
  return null;
}

export async function saveCompanyLogo(bytes: Buffer, declaredMime: string): Promise<string> {
  const type = logoType(bytes);
  if (!type || type.mime !== declaredMime) throw badRequest('Image content does not match its declared type', 'INVALID_IMAGE');
  if (bytes.length > LOGO_MAX_BYTES) throw badRequest('Image exceeds the upload limit', 'PAYLOAD_TOO_LARGE');
  const filename = `logo-${randomUUID()}${type.extension}`;
  // Store the bytes before publishing their URL. Keep earlier versions for cached receipts/devices.
  await CompanyLogoModel.create({ _id: filename, mimeType: type.mime, data: bytes, createdAt: new Date().toISOString() });
  const url = `/uploads/${filename}`;
  const current = await getSettings();
  await updateSettingsSection('company', { ...current.company, logoUrl: url });
  return url;
}

/** Keeps the existing image URL usable by web, labels and desktop print CSP. No disk fallback. */
export const companyLogoRouter = Router();
companyLogoRouter.get('/:filename', async (req, res, next) => {
  try {
    const filename = req.params.filename as string;
    if (!LOGO_FILENAME.test(filename)) throw notFound('Logo not found');
    const logo = await CompanyLogoModel.findById(filename);
    if (!logo) throw notFound('Logo not found');
    res.set('Cache-Control', 'public, max-age=604800, immutable').type(logo.mimeType).send(Buffer.from(logo.data));
  } catch (e) {
    next(e);
  }
});

/** Copies the currently configured legacy file once, preserving its URL and original file. */
export async function migrateCompanyLogo(): Promise<void> {
  const settings = await SettingsModel.findById('app').lean();
  const url = settings?.value.company?.logoUrl;
  if (!url?.startsWith('/uploads/')) return;
  const filename = url.slice('/uploads/'.length);
  if (!LOGO_FILENAME.test(filename) || await CompanyLogoModel.exists({ _id: filename })) return;
  const file = path.join(path.resolve(env.UPLOAD_DIR), filename);
  let bytes: Buffer;
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > LOGO_MAX_BYTES) {
      logger.warn({ filename }, 'Legacy company logo cannot be migrated: invalid file or size');
      return;
    }
    bytes = await readFile(file);
  } catch (err) {
    logger.warn({ err, filename }, 'Legacy company logo unavailable; upload it again to store it in MongoDB');
    return;
  }
  const type = logoType(bytes);
  const extension = path.extname(filename).toLowerCase();
  if (!type || bytes.length > LOGO_MAX_BYTES || (extension !== type.extension && !(type.mime === 'image/jpeg' && extension === '.jpeg'))) {
    logger.warn({ filename }, 'Legacy company logo cannot be migrated: invalid image content');
    return;
  }
  await CompanyLogoModel.updateOne({ _id: filename }, { $setOnInsert: { mimeType: type.mime, data: bytes, createdAt: new Date().toISOString() } }, { upsert: true });
  logger.info({ filename }, 'Company logo migrated to MongoDB');
}
