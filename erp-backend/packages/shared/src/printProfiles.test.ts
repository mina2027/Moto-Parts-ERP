import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultPrintProfiles, mergeAppSettings, PAPER_SIZES } from './constants';
import { normalizePrintProfile } from './printProfiles';
import { PaperKindSchema, ReceiptSettingsSchema } from './schemas';
import { invoiceContentWidthMm, invoiceRollHeightMm } from './invoicePage';

describe('system invoice paper sizes', () => {
  it('offers only 80mm and A4 and rejects discontinued sizes in new settings', () => {
    expect(Object.keys(PAPER_SIZES)).toEqual(['thermal80', 'a4']);
    expect(new Set(defaultPrintProfiles().map(p => p.paper))).toEqual(new Set(['thermal80', 'a4']));
    expect(PaperKindSchema.safeParse('thermal58').success).toBe(false);
    expect(PaperKindSchema.safeParse('a5').success).toBe(false);
    expect(ReceiptSettingsSchema.safeParse({ ...DEFAULT_SETTINGS.receipt, paperWidth: 58 }).success).toBe(false);
  });

  it('upgrades old settings and profiles without losing printers or profile options', () => {
    const oldSettings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(oldSettings.receipt, { paperWidth: 58 });
    expect(mergeAppSettings(oldSettings).receipt.paperWidth).toBe(80);
    for (const [oldPaper, paper, name] of [['thermal58', 'thermal80', 'Thermal 58mm'], ['a5', 'a4', 'A5 invoice']] as const) {
      const profile = { ...defaultPrintProfiles()[0], paper: oldPaper, name, printerName: 'Configured printer' };
      const normalized = normalizePrintProfile(profile);
      expect(normalized).toMatchObject({ paper, printerName: 'Configured printer', copies: profile.copies });
      expect(profile.paper).toBe(oldPaper);
      expect(normalized.name).not.toMatch(/58mm|A5/);
    }
  });

  it('keeps the full paper width and rounds the content length up for the roll', () => {
    expect(invoiceContentWidthMm(80)).toBe(80);
    expect(invoiceContentWidthMm(210)).toBe(210);
    const height = 800 * 25.4 / 96;
    expect(invoiceRollHeightMm(800, 80)).toBe(Math.ceil(height + 4));
  });
});
