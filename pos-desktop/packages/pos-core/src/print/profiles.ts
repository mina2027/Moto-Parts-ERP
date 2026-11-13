import { defaultPrintProfiles, normalizePrintProfile } from '@moto/shared';
import type { PrintProfile } from '@moto/shared';

export type InvoiceSize = 'small' | 'large';

/** Checkout has two fixed layouts, independent of saved server or device templates. */
export function checkoutProfileForSize(size: InvoiceSize): PrintProfile {
  const paper = size === 'small' ? 'thermal80' : 'a4';
  const profile = defaultPrintProfiles().find((p) => p.paper === paper && p.detail === 'detailed')!;
  return { ...profile, id: `invoice-${size}` };
}

/** Both invoice buttons use exact paper dimensions at the original design scale. */
export function invoiceProfileForSize(profile: PrintProfile, size: InvoiceSize): PrintProfile {
  return { ...normalizePrintProfile(profile), paper: size === 'small' ? 'thermal80' : 'a4' };
}

/** Keep both receipt sizes available even before a server profile has been configured. */
export function availablePrintProfiles(profiles: PrintProfile[]): PrintProfile[] {
  const defaults = defaultPrintProfiles();
  const list = profiles.map(normalizePrintProfile);
  if (!list.some((p) => p.paper === 'thermal80')) list.push(defaults.find((p) => p.paper === 'thermal80')!);
  if (!list.some((p) => p.paper === 'a4')) list.push(defaults.find((p) => p.paper === 'a4')!);
  return list;
}

export function profileForSize(profiles: PrintProfile[], size: InvoiceSize, deviceId: string | null): PrintProfile {
  const matching = availablePrintProfiles(profiles).filter((p) => p.paper === (size === 'small' ? 'thermal80' : 'a4'));
  const profile = matching.find((p) => p.id === deviceId) ?? matching.find((p) => p.isDefault) ?? matching[0]!;
  return invoiceProfileForSize(profile, size);
}
