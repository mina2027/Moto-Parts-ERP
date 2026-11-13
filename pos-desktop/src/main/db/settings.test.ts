import { describe, expect, it } from 'vitest';
import type { AppSettings } from '@moto/shared';
import { DEFAULT_SETTINGS } from '@moto/shared';
import { emptyPull, memDb } from '../test/helpers';

/**
 * A terminal keeps whatever settings document it last pulled. When the app gains a receipt field, that cached
 * document is missing it — and the invoice templates read `receipt.warrantyNotes`/`brandLogos` unguarded, so the
 * whole POS went blank on the first print after an upgrade.
 */
describe('cached settings', () => {
  const stale = {
    ...DEFAULT_SETTINGS,
    receipt: { paperWidth: 80, showBarcode: true, showCashier: true, showCustomerBalance: true, copies: 1, headerLines: ['موتو بارتس'] },
  } as unknown as AppSettings;

  it('fills in receipt fields the cached document predates', () => {
    const db = memDb();
    db.applyPull(emptyPull({ settings: stale }), 'br-1', true);
    const s = db.settings()!;
    expect(s.receipt.warrantyNotes).toEqual(DEFAULT_SETTINGS.receipt.warrantyNotes);
    expect(s.receipt.brandLogos).toEqual(DEFAULT_SETTINGS.receipt.brandLogos);
    expect(s.receipt.subtitle).toEqual(DEFAULT_SETTINGS.receipt.subtitle);
    db.close();
  });

  it('keeps the stored values that are present', () => {
    const db = memDb();
    db.applyPull(emptyPull({ settings: stale }), 'br-1', true);
    expect(db.settings()!.receipt.headerLines).toEqual(['موتو بارتس']);
    db.close();
  });

  it('returns null when nothing was ever pulled', () => {
    const db = memDb();
    expect(db.settings()).toBeNull();
    db.close();
  });
});
