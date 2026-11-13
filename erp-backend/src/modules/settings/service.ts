import type { ClientSession } from 'mongoose';
import type { AppSettings } from '@moto/shared';
import { mergeAppSettings, SOCKET_EVENTS } from '@moto/shared';
import { SettingsModel } from '../../db/models.js';
import { badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { emitGlobal } from '../../realtime/socket.js';
import { signTaxSnapshot } from './taxSnapshot.js';

const SETTINGS_ID = 'app';
let cache: { value: AppSettings; at: number } | null = null;
const TTL = 5_000;

export async function getSettings(session?: ClientSession): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < TTL && !session) return cache.value;
  const doc = await SettingsModel.findById(SETTINGS_ID).session(session ?? null).lean();
  const value = mergeAppSettings(doc?.value);
  value.invoice.taxSnapshot = signTaxSnapshot(value.invoice);
  if (!session) cache = { value, at: Date.now() };
  return value;
}

export async function updateSettingsSection<K extends keyof AppSettings>(section: K, value: AppSettings[K]): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, [section]: { ...(current[section] as object), ...(value as object) } } as AppSettings;
  next.invoice = { ...next.invoice, showTax: false, taxEnabled: false, taxRate: 0, allowNegativeStock: false };
  next.invoice.taxSnapshot = signTaxSnapshot(next.invoice);
  if (section === 'alerts' && next.alerts.whatsappOnCritical && env.WHATSAPP_MODE !== 'cloud') throw badRequest('Automatic WhatsApp alerts require Cloud API mode', 'WHATSAPP_CLOUD_REQUIRED');
  await SettingsModel.updateOne({ _id: SETTINGS_ID }, { $set: { value: next } }, { upsert: true });
  cache = { value: next, at: Date.now() };
  emitGlobal(SOCKET_EVENTS.settingsChanged, { section });
  return next;
}

export async function replaceSettings(value: AppSettings) {
  value = mergeAppSettings(value);
  value.invoice.taxSnapshot = signTaxSnapshot(value.invoice);
  await SettingsModel.updateOne({ _id: SETTINGS_ID }, { $set: { value } }, { upsert: true });
  cache = { value, at: Date.now() };
}

export function invalidateSettingsCache() {
  cache = null;
}
