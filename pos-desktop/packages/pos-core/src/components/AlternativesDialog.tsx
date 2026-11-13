import * as React from 'react';
import type { AlternativeSuggestion, AppSettings, PriceTier, Product } from '@moto/shared';
import { clampPriceTier } from '@moto/shared';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, cn } from '@moto/ui';
import { ArrowLeftRight, MapPin, PackageSearch, Plus, Replace } from 'lucide-react';
import { formatMoney, usePosT } from '../i18n';

export interface AlternativesDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  requested: Product | null;
  requestedAvailable: number;
  suggestions: AlternativeSuggestion[] | undefined;
  loading: boolean;
  settings: AppSettings;
  tier: PriceTier;
  /** Tiers this user may sell at; nothing outside the list is rendered or reachable. */
  allowedTiers: PriceTier[];
  canTransfer: boolean;
  /** Replace the requested line (if in cart) or add. */
  onPick: (alt: AlternativeSuggestion, mode: 'replace' | 'add', tier: PriceTier) => void;
  onRequestTransfer?: (alt: AlternativeSuggestion, branchId: string) => void;
  branchName?: (id: string) => string;
  inCart: boolean;
}

const ORDER: AlternativeSuggestion['matchReason'][] = ['explicit', 'compat_same_model', 'part_family'];

export function AlternativesDialog({ open, onOpenChange, requested, requestedAvailable, suggestions, loading, settings, tier, allowedTiers, canTransfer, onPick, onRequestTransfer, branchName, inCart }: AlternativesDialogProps) {
  const { p, tx, locale } = usePosT();
  const [pickTier, setPickTier] = React.useState<PriceTier>(() => clampPriceTier(tier, allowedTiers));
  React.useEffect(() => setPickTier(clampPriceTier(tier, allowedTiers)), [tier, allowedTiers, open]);
  const groups = React.useMemo(() => {
    const g = new Map<AlternativeSuggestion['matchReason'], AlternativeSuggestion[]>();
    for (const s of suggestions ?? []) g.set(s.matchReason, [...(g.get(s.matchReason) ?? []), s]);
    return ORDER.filter((k) => g.has(k)).map((k) => [k, g.get(k)!] as const);
  }, [suggestions]);
  const sym = settings.currency.symbol;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[85vh] overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="size-5" /> {p.alternativesFor}: {requested ? tx(requested.name) : '—'}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {requested ? <span className="num text-xs">{requested.partNumber} · {requested.sku}</span> : null}
            <Badge variant={requestedAvailable > 0 ? 'success' : 'destructive'}>{p.inStock}: {requestedAvailable}</Badge>
            <span className="ms-auto inline-flex rounded-md border p-0.5">
              {allowedTiers.map((t) => (
                <Button key={t} size="xs" className="h-6" variant={pickTier === t ? 'secondary' : 'ghost'} onClick={() => setPickTier(t)}>
                  {tx(settings.pricing.tierLabels[t])}
                </Button>
              ))}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">…</div>
          ) : !suggestions?.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{p.noAlternatives}</div>
          ) : (
            groups.map(([reason, list]) => (
              <div key={reason} className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p[reason]}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {list.map((s) => {
                    const inStock = s.qtyAvailable > 0;
                    return (
                      <div key={s.product.id} className={cn('rounded-md border p-3', inStock ? 'bg-card' : 'bg-muted/30')}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{tx(s.product.name)}</div>
                            <div className="num text-[11px] text-muted-foreground">{s.product.partNumber} · {s.product.sku}</div>
                            {s.location ? <div className="flex items-center gap-1 text-[11px] font-medium text-primary"><MapPin className="size-3" /> {s.location}</div> : null}
                          </div>
                          <Badge variant={inStock ? 'success' : 'destructive'} className="shrink-0">
                            {p.stock}: {s.qtyAvailable}
                          </Badge>
                        </div>
                        {s.sharedModels.length ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {p.fitsModels}: {s.sharedModels.map((m) => `${m.code} (${m.years})`).join('، ')}
                          </div>
                        ) : null}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-sm font-bold num">{formatMoney(s.prices[pickTier], locale, sym, 0)}</span>
                          <div className="flex gap-1">
                            {inStock ? (
                              <>
                                {inCart ? (
                                  <Button size="xs" variant="secondary" onClick={() => onPick(s, 'replace', pickTier)}>
                                    <Replace /> {p.replaceLine}
                                  </Button>
                                ) : null}
                                <Button size="xs" onClick={() => onPick(s, 'add', pickTier)}>
                                  <Plus /> {p.addLine}
                                </Button>
                              </>
                            ) : s.otherBranches.length && canTransfer && onRequestTransfer ? (
                              <Button size="xs" variant="outline" onClick={() => onRequestTransfer(s, s.otherBranches[0]!.branchId)}>
                                <ArrowLeftRight /> {p.requestTransfer}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {s.otherBranches.length ? (
                          <div className="mt-1.5 text-[11px] text-muted-foreground">
                            {p.otherBranches}: {s.otherBranches.map((b) => `${branchName ? branchName(b.branchId) : b.branchId} (${b.qty})`).join('، ')}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
