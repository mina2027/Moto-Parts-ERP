import { defaultPrintProfiles, normalizePrintProfile } from '@moto/shared';
import type { PrintProfile } from '@moto/shared';
import { PRINT_PREF, type PosApi } from './ipc';

export type InvoiceSize = 'small' | 'large';
export const SIMPLE_PRINT_PREF = {
  printer: (size: InvoiceSize) => `invoicePrinter:${size}`,
};

/** Read old settings once as a fallback so a previously selected printer keeps working. */
export function invoicePreferences(get: (key: string) => string | null, legacy: PrintProfile[]) {
  legacy = legacy.map(normalizePrintProfile);
  const device = legacy.find((p) => p.id === get(PRINT_PREF.deviceProfile));
  const small = (device?.paper === 'thermal80' ? device : undefined)
    ?? legacy.find((p) => p.isDefault && p.paper === 'thermal80')
    ?? legacy.find((p) => p.paper === 'thermal80');
  const large = legacy.find((p) => p.id === 'invoice-large') ?? legacy.find((p) => p.paper === 'a4');
  const printer = (size: InvoiceSize, profile: PrintProfile | undefined) => {
    const configured = get(SIMPLE_PRINT_PREF.printer(size));
    return configured !== null ? configured || null : (profile && (get(PRINT_PREF.printer(profile.id)) || profile.printerName)) || null;
  };
  return {
    smallPrinter: printer('small', small),
    largePrinter: printer('large', large),
  } as const;
}

export function invoiceProfiles(prefs: ReturnType<typeof invoicePreferences>): PrintProfile[] {
  const defaults = defaultPrintProfiles();
  return [
    { ...defaults.find((p) => p.paper === 'thermal80')!, id: 'invoice-small', name: 'فاتورة صغيرة', printerName: prefs.smallPrinter || undefined },
    { ...defaults.find((p) => p.paper === 'a4')!, id: 'invoice-large', name: 'فاتورة كبيرة', printerName: prefs.largePrinter || undefined },
  ];
}

/** Normalize both old and current IPC responses; never show one settings section per legacy template. */
export async function loadInvoiceProfiles(data: Pick<PosApi['data'], 'printProfiles' | 'getPref'>): Promise<PrintProfile[]> {
  const profiles = await data.printProfiles();
  const keys = [...new Set([
    PRINT_PREF.deviceProfile,
    SIMPLE_PRINT_PREF.printer('small'),
    SIMPLE_PRINT_PREF.printer('large'),
    ...profiles.map((profile) => PRINT_PREF.printer(profile.id)),
  ])];
  const values = await Promise.all(keys.map((key) => data.getPref(key)));
  const prefs = new Map(keys.map((key, index) => [key, values[index]]));
  return invoiceProfiles(invoicePreferences((key) => prefs.get(key) ?? null, profiles));
}
