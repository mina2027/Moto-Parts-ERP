import type { PaperKind, PrintProfile } from './types';

/** Old cached profiles keep their printer and options while adopting the supported paper size. */
export function normalizeInvoicePaper(paper: unknown): PaperKind {
  return paper === 'a4' || paper === 'a5' ? 'a4' : 'thermal80';
}

export function normalizePrintProfile(profile: Omit<PrintProfile, 'paper'> & { paper: unknown }): PrintProfile {
  const paper = normalizeInvoicePaper(profile.paper);
  const name = profile.paper === 'a5' ? profile.name.replace(/\bA5\b/gi, 'A4')
    : profile.paper === 'thermal58' ? profile.name.replace(/58\s*(mm|مم)/gi, '80$1') : profile.name;
  return { ...profile, name, paper };
}
