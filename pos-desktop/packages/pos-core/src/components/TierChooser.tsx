import * as React from 'react';
import type { AppSettings, PriceTier, ProductPrices, SalePriceTier } from '@moto/shared';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@moto/ui';
import { formatMoney, usePosT } from '../i18n';

export interface TierChooserProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  prices: ProductPrices;
  current: SalePriceTier;
  specialPrice?: number | null;
  settings: AppSettings;
  /** Tiers this user may sell at; nothing outside the list is rendered or reachable. */
  allowedTiers: PriceTier[];
  onPick: (tier: SalePriceTier, price: number) => void;
  children: React.ReactNode;
}

/**
 * Lightweight popover anchored to a cart line showing the permitted tier prices as big buttons.
 * Keyboard: 1..n pick, Esc keeps current.
 */
export function TierChooser({ open, onOpenChange, prices, current, specialPrice, settings, allowedTiers, onPick, children }: TierChooserProps) {
  const { p, tx, locale } = usePosT();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.key) - 1;
      const tier = Number.isInteger(idx) && idx >= 0 ? allowedTiers[idx] : undefined;
      if (tier) {
        e.preventDefault();
        onPick(tier, prices[tier]);
        onOpenChange(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, prices, allowedTiers, onPick, onOpenChange]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild ref={triggerRef}>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2" onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); }}>
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">{p.selectPrice}</div>
        <div className={cn('grid gap-1.5', allowedTiers.length >= 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {allowedTiers.map((tier: PriceTier, i) => {
            return (
              <Button
                key={tier}
                type="button"
                variant={current === tier ? 'default' : 'outline'}
                className={cn('h-16 flex-col gap-0.5 px-1')}
                onClick={() => {
                  onPick(tier, prices[tier]);
                  onOpenChange(false);
                }}
              >
                <span className="text-[10px] opacity-80">
                  <kbd className="rounded border px-1">{i + 1}</kbd> {tx(settings.pricing.tierLabels[tier])}
                </span>
                <span className="text-sm font-bold num">{formatMoney(prices[tier], locale, settings.currency.symbol, 0)}</span>
              </Button>
            );
          })}
        </div>
        {specialPrice != null ? (
          <Button
            type="button"
            variant={current === 'special' ? 'default' : 'secondary'}
            className="mt-1.5 h-9 w-full justify-between"
            onClick={() => {
              onPick('special', specialPrice);
              onOpenChange(false);
            }}
          >
            <span className="text-xs">{p.special}</span>
            <span className="font-bold num">{formatMoney(specialPrice, locale, settings.currency.symbol, 0)}</span>
          </Button>
        ) : null}
        <div className="mt-1.5 text-[10px] text-muted-foreground">{p.tierHint}</div>
      </PopoverContent>
    </Popover>
  );
}

export function tierBadgeLabel(settings: AppSettings, tier: SalePriceTier, p: { special: string; manual: string }, locale: 'ar' | 'en') {
  if (tier === 'special') return p.special;
  if (tier === 'manual') return p.manual;
  const l = settings.pricing.tierLabels[tier];
  return locale === 'en' ? l.en || l.ar : l.ar;
}
