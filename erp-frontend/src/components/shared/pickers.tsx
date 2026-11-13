import * as React from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { cn, matchSearch } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  sublabel?: string;
  keywords?: string[];
}

export function Combobox({ value, onChange, options, placeholder, searchPlaceholder, className, disabled, allowClear, ariaLabel, size = 'default' }: { value?: string | null; onChange: (v: string | null) => void; options: ComboOption[]; placeholder?: string; searchPlaceholder?: string; className?: string; disabled?: boolean; allowClear?: boolean; ariaLabel?: string; size?: 'sm' | 'default' }) {
  const { t } = useT();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const filtered = React.useMemo(() => options.filter((o) => matchSearch([o.label, o.sublabel, ...(o.keywords ?? [])], q)).slice(0, 60), [options, q]);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(''); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-label={ariaLabel} aria-expanded={open} disabled={disabled} className={cn('w-full justify-between font-normal', size === 'sm' ? 'h-8 text-xs' : 'h-9', !selected && 'text-muted-foreground', className)}>
          <span className="truncate">{selected ? selected.label : placeholder ?? t('common.select')}</span>
          <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0" align="start">
        <div className="border-b p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder ?? t('common.search')} className="h-8" startIcon={<Search />} />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {allowClear && value ? (
            <button type="button" className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent" onClick={() => { onChange(null); setOpen(false); }}>
              {t('common.none')}
            </button>
          ) : null}
          {filtered.length === 0 ? <div className="px-2 py-4 text-center text-xs text-muted-foreground">{t('common.noResults')}</div> : null}
          {filtered.map((o) => (
            <button key={o.value} type="button" className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent', o.value === value && 'bg-accent/60')} onClick={() => { onChange(o.value); setOpen(false); }}>
              <Check className={cn('size-4 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{o.label}</span>
                {o.sublabel ? <span className="block truncate text-xs text-muted-foreground">{o.sublabel}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NumberStepper({ value, onChange, min = 0, max, step = 1, className, size = 'default' }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; className?: string; size?: 'sm' | 'default' }) {
  const clamp = (n: number) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  const h = size === 'sm' ? 'h-7' : 'h-8';
  return (
    <div className={cn('inline-flex items-center rounded-md border', className)} dir="ltr">
      <button type="button" className={cn('px-2 text-sm hover:bg-accent disabled:opacity-40', h)} onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label="decrease">−</button>
      <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(clamp(Number(e.target.value) || 0))} className={cn('w-12 border-x bg-transparent text-center text-sm tabular focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none', h)} />
      <button type="button" className={cn('px-2 text-sm hover:bg-accent disabled:opacity-40', h)} onClick={() => onChange(clamp(value + step))} disabled={max !== undefined && value >= max} aria-label="increase">+</button>
    </div>
  );
}
