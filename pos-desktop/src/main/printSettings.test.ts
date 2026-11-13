import { describe, expect, it } from 'vitest';
import { defaultPrintProfiles, type PrintProfile } from '@moto/shared';
import { invoicePreferences, invoiceProfiles, loadInvoiceProfiles, SIMPLE_PRINT_PREF } from '../shared/printSettings';

describe('simple invoice configuration', () => {
  it('normalizes saved templates to exactly one small and one A4 settings section', async () => {
    const prefs = new Map([[SIMPLE_PRINT_PREF.printer('small'), 'Receipt'], ['invoicePaper:small', 'thermal58']]);
    const profiles = await loadInvoiceProfiles({ printProfiles: async () => defaultPrintProfiles(), getPref: async (key) => prefs.get(key) ?? null });
    expect(profiles.map((profile) => [profile.id, profile.paper])).toEqual([['invoice-small', 'thermal80'], ['invoice-large', 'a4']]);
    expect(profiles[0].printerName).toBe('Receipt');
  });

  it('preserves configured printers when IPC already returns the two simplified profiles', async () => {
    const profiles = invoiceProfiles({ smallPrinter: 'Receipt', largePrinter: 'Office' });
    const loaded = await loadInvoiceProfiles({ printProfiles: async () => profiles, getPref: async () => null });
    expect(loaded).toEqual(profiles);
  });
  it('provides two fixed layouts when no printers are configured', () => {
    const profiles = invoiceProfiles(invoicePreferences(() => null, []));
    expect(profiles.map((p) => p.paper)).toEqual(['thermal80', 'a4']);
    expect(profiles.every((p) => !p.printerName)).toBe(true);
  });

  it('keeps the previously configured printer while replacing its 58mm layout', () => {
    const prefs = new Map([['printProfile', 'pp-thermal58'], ['printer:pp-thermal58', 'Receipt'], ['printer:pp-a4', 'Office']]);
    const legacy = [...defaultPrintProfiles(), { ...defaultPrintProfiles()[0], id: 'pp-thermal58', paper: 'thermal58' } as unknown as PrintProfile];
    const preferences = invoicePreferences((key) => prefs.get(key) ?? null, legacy);
    expect(preferences).toEqual({ smallPrinter: 'Receipt', largePrinter: 'Office' });
    expect(invoiceProfiles(preferences)[0]).toMatchObject({ paper: 'thermal80', printerName: 'Receipt' });
  });

  it('an explicit ask-each-time choice overrides legacy defaults', () => {
    const prefs = new Map([['printer:pp-thermal80', 'Old printer'], [SIMPLE_PRINT_PREF.printer('small'), '']]);
    expect(invoicePreferences((key) => prefs.get(key) ?? null, defaultPrintProfiles()).smallPrinter).toBeNull();
  });

  it('uses the selected printer independently for each size', () => {
    const prefs = new Map([[SIMPLE_PRINT_PREF.printer('small'), 'Receipt'], [SIMPLE_PRINT_PREF.printer('large'), 'Office'], ['invoicePaper:small', 'thermal58']]);
    expect(invoiceProfiles(invoicePreferences((key) => prefs.get(key) ?? null, [])).map((p) => [p.paper, p.printerName])).toEqual([['thermal80', 'Receipt'], ['a4', 'Office']]);
  });

  it('corrects saved simplified profiles that still use 58mm or A5', async () => {
    const profiles = invoiceProfiles({ smallPrinter: 'Receipt', largePrinter: 'Office' });
    Object.assign(profiles[0], { paper: 'thermal58' });
    Object.assign(profiles[1], { paper: 'a5' });
    const loaded = await loadInvoiceProfiles({ printProfiles: async () => profiles, getPref: async () => null });
    expect(loaded.map((p) => [p.paper, p.printerName])).toEqual([['thermal80', 'Receipt'], ['a4', 'Office']]);
  });
});
