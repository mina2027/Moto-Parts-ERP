import { createHmac, timingSafeEqual } from 'node:crypto';
import { invoiceTaxRate, type InvoiceSettings } from '@moto/shared';
import { env } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';

const signature = (payload: string) => createHmac('sha256', env.JWT_SECRET).update(`invoice-tax-v1:${payload}`).digest();

export function signTaxSnapshot(invoice: InvoiceSettings): string {
  const payload = Buffer.from(JSON.stringify({ rate: invoiceTaxRate(invoice) })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

export function readTaxSnapshot(token: string): number {
  try {
    const parts = token.split('.');
    const supplied = Buffer.from(parts[1] ?? '', 'base64url');
    const expected = signature(parts[0]!);
    if (parts.length !== 2 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('signature');
    const { rate } = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as { rate: number };
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('rate');
    return rate;
  } catch {
    throw badRequest('Offline tax configuration is invalid; reconcile the invoice', 'INVALID_TAX_SNAPSHOT');
  }
}
