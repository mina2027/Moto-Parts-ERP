import type { AlternativeSuggestion, MotorcycleModel, Product } from '@moto/shared';
import { productCategoryIds } from '@moto/shared';
import type { LocalDb } from '../db/database';

function partFamily(partNumber: string): string {
  const parts = partNumber.split('-');
  return parts.length > 1 ? parts.slice(0, 2).join('-') : partNumber.slice(0, Math.max(3, Math.floor(partNumber.length * 0.6)));
}

/** Offline mirror of the server ranking: explicit > same model+category > part family; in-stock first. */
export function localAlternatives(db: LocalDb, productId: string, branchId: string): AlternativeSuggestion[] {
  const all = db.products(branchId);
  const base = all.find((p) => p.id === productId);
  if (!base) return [];
  const models = new Map<string, MotorcycleModel>(db.models().map((m) => [m.id, m]));
  const family = partFamily(base.partNumber ?? '');
  const baseCategories = productCategoryIds(base);
  const rank = { explicit: 0, compat_same_model: 1, part_family: 2 } as const;
  const out: AlternativeSuggestion[] = [];
  for (const c of all) {
    if (c.id === base.id || !c.isActive) continue;
    const sharedIds = c.compatibleModelIds.filter((id) => base.compatibleModelIds.includes(id));
    const sameCategory = productCategoryIds(c).some(id => baseCategories.includes(id));
    let reason: AlternativeSuggestion['matchReason'] | null = null;
    if (base.alternativeProductIds.includes(c.id)) reason = 'explicit';
    else if (sharedIds.length && sameCategory) reason = 'compat_same_model';
    else if (family.length >= 3 && sameCategory && (c.partNumber ?? '').toLowerCase().startsWith(family.toLowerCase())) reason = 'part_family';
    if (!reason) continue;
    out.push({ product: c as Product, qtyAvailable: c.available, matchReason: reason, sharedModels: sharedIds.map((id) => models.get(id)).filter((m): m is MotorcycleModel => Boolean(m)), prices: c.prices, otherBranches: [] });
  }
  return out.sort((a, b) => {
    const inA = a.qtyAvailable > 0 ? 0 : 1;
    const inB = b.qtyAvailable > 0 ? 0 : 1;
    if (inA !== inB) return inA - inB;
    if (rank[a.matchReason] !== rank[b.matchReason]) return rank[a.matchReason] - rank[b.matchReason];
    return b.sharedModels.length - a.sharedModels.length || b.qtyAvailable - a.qtyAvailable;
  });
}
