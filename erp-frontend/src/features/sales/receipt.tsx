import * as React from 'react';
import { InvoiceDocument, PosLocaleContext, pageStyleFor, checkoutProfileForSize, type InvoiceSize } from '@moto/pos-core';
import type { PrintProfile, Sale } from '@/types';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useUiStore } from '@/stores/uiStore';

const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || (typeof window !== 'undefined' ? window.location.origin : '');

/** Invoice size is explicit; profile overrides are used only by the settings preview. */
export const Receipt = React.forwardRef<HTMLDivElement, { sale: Sale; size?: InvoiceSize; profile?: PrintProfile | null }>(function Receipt({ sale, size = 'small', profile }, ref) {
  const locale = useUiStore((s) => s.locale);
  const { settings } = useSettings();
  const { branches, users, customers, products, models, brands, categories } = useLookups();
  const chosen = profile ?? checkoutProfileForSize(size);
  return (
    <PosLocaleContext.Provider value={locale}>
      <style>{pageStyleFor(chosen)}</style>
      <InvoiceDocument
        ref={ref}
        sale={sale}
        profile={chosen}
        settings={settings}
        branch={branches.find((b) => b.id === sale.branchId) ?? null}
        cashier={users.find((u) => u.id === sale.cashierId) ?? null}
        customer={customers.find((c) => c.id === sale.customerId) ?? null}
        products={Object.fromEntries(products.map((p) => [p.id, p]))}
        brands={Object.fromEntries(brands.map((b) => [b.id, b]))}
        categories={Object.fromEntries(categories.map((c) => [c.id, c]))}
        models={Object.fromEntries(models.map((m) => [m.id, m]))}
        verifyBaseUrl={PUBLIC_URL}
      />
    </PosLocaleContext.Provider>
  );
});
