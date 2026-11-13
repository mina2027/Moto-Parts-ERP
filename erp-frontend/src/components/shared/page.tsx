import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, FileDown, FileSpreadsheet, Printer, Search, X, SlidersHorizontal, TrendingDown, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/i18n';
import { cn, formatMoney, formatNumber } from '@/lib/utils';
import { EmptyExportError, exportCsv, exportPdf, exportXlsx, type ExportPayload } from '@/lib/export';
import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions, backTo, badge, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; backTo?: string; badge?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2">
        {backTo ? (
          <Button asChild variant="ghost" size="icon-sm" className="mt-0.5 shrink-0">
            <Link to={backTo} aria-label="back">
              <ChevronLeft className="ltr:rotate-0 rtl:rotate-180" />
            </Link>
          </Button>
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            {badge}
          </div>
          {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ title, value, icon, change, hint, variant = 'default', className, format = 'money', onClick }: { title: ReactNode; value: number | string; icon?: ReactNode; change?: number; hint?: ReactNode; variant?: 'default' | 'success' | 'warning' | 'destructive' | 'info'; className?: string; format?: 'money' | 'number' | 'raw'; onClick?: () => void }) {
  const { t, locale } = useT();
  const colors = { default: 'text-primary bg-primary/10', success: 'text-success bg-success/10', warning: 'text-amber-600 bg-warning/10', destructive: 'text-destructive bg-destructive/10', info: 'text-sky-600 bg-info/10' }[variant];
  const display = typeof value === 'string' ? value : format === 'money' ? formatMoney(value, locale) : format === 'number' ? formatNumber(value) : String(value);
  return (
    <Card className={cn(onClick && 'cursor-pointer transition-colors hover:bg-accent/40', className)} onClick={onClick}>
      <CardContent className="flex items-start justify-between gap-3 p-3.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-muted-foreground">{title}</div>
          <div className="mt-1 truncate text-xl font-semibold tabular">{display}</div>
          {change !== undefined ? (
            <div className={cn('mt-1 flex items-center gap-1 text-[11px]', change >= 0 ? 'text-success' : 'text-destructive')}>
              {change >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              <span className="num">{change > 0 ? '+' : ''}{formatNumber(change, 1)}%</span>
              <span className="text-muted-foreground">{t('common.vs')} {t('common.prevPeriod')}</span>
            </div>
          ) : hint ? (
            <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
          ) : null}
        </div>
        {icon ? <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-[18px]', colors)}>{icon}</div> : null}
      </CardContent>
    </Card>
  );
}

export function SearchInput({ value, onChange, placeholder, className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const { t } = useT();
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? t('common.searchPlaceholder')}
      className={cn('h-8 w-full sm:w-56', className)}
      startIcon={<Search />}
      endIcon={value ? <button type="button" onClick={() => onChange('')} className="pointer-events-auto hover:text-foreground" aria-label="clear"><X /></button> : undefined}
      autoFocus={autoFocus}
    />
  );
}

export function FilterSelect({ value, onChange, options, placeholder, allLabel, className, width = 'w-40' }: { value?: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; allLabel?: string; className?: string; width?: string }) {
  const { t } = useT();
  return (
    <Select value={value ?? 'all'} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn(width, className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel ?? t('common.all')}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterBar({ children, activeCount, onClear, className }: { children: ReactNode; activeCount?: number; onClear?: () => void; className?: string }) {
  const { t } = useT();
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <SlidersHorizontal className="size-4 text-muted-foreground" />
      {children}
      {activeCount && onClear ? (
        <Button size="xs" variant="ghost" onClick={onClear} className="text-muted-foreground">
          <X /> {t('common.clearFilters')} <Badge variant="secondary" className="ms-1">{activeCount}</Badge>
        </Button>
      ) : null}
    </div>
  );
}

export function DateRangeInputs({ from, to, onChange, className }: { from?: string; to?: string; onChange: (from?: string, to?: string) => void; className?: string }) {
  const { t } = useT();
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Input type="date" value={from?.slice(0, 10) ?? ''} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined, to)} className="h-8 w-[140px] text-xs" aria-label={t('common.from')} />
      <span className="text-xs text-muted-foreground">–</span>
      <Input type="date" value={to?.slice(0, 10) ?? ''} onChange={(e) => onChange(from, e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : undefined)} className="h-8 w-[140px] text-xs" aria-label={t('common.until')} />
    </div>
  );
}

export interface ExportMenuProps<T = unknown> {
  onPrint?: () => void;
  size?: 'sm' | 'xs';
  /** Resolved lazily so the export always reflects the filters active at click time. */
  payload?: () => ExportPayload<T> | Promise<ExportPayload<T>>;
}

export function ExportMenu<T = unknown>({ onPrint, size = 'sm', payload }: ExportMenuProps<T>) {
  const { t, locale } = useT();
  const [busy, setBusy] = React.useState(false);

  const run = async (kind: 'csv' | 'xlsx' | 'pdf') => {
    if (!payload) return toast.info(t('reports.exportHint'));
    setBusy(true);
    try {
      const data = await payload();
      const withDir: ExportPayload<T> = { ...data, rtl: data.rtl ?? locale === 'ar' };
      if (kind === 'csv') exportCsv(withDir);
      else if (kind === 'xlsx') exportXlsx(withDir);
      else exportPdf(withDir);
      if (kind !== 'pdf') toast.success(t('common.exportDone', { n: data.rows.length }));
    } catch (e) {
      if (e instanceof EmptyExportError) toast.warning(t('common.exportEmpty'));
      else if (e instanceof Error && e.message === 'POPUP_BLOCKED') toast.error(t('common.exportPopupBlocked'));
      else toast.error(t('common.exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={busy}>
          <FileDown /> {t('common.export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run('xlsx')}><FileSpreadsheet /> {t('common.exportExcel')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run('csv')}><FileDown /> {t('common.exportCsv')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run('pdf')}><FileDown /> {t('common.exportPdf')}</DropdownMenuItem>
        <DropdownMenuItem onClick={onPrint ?? (() => window.print())}><Printer /> {t('common.print')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Money({ value, className, colored, compact }: { value: number; className?: string; colored?: boolean; compact?: boolean }) {
  const { locale } = useT();
  return <span className={cn('num', colored && value > 0 && 'text-success', colored && value < 0 && 'text-destructive', className)}>{formatMoney(value, locale, { compact })}</span>;
}

export function KeyValue({ items, cols = 2, className }: { items: { label: ReactNode; value: ReactNode; className?: string }[]; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' }[cols];
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', grid, className)}>
      {items.map((it, i) => (
        <div key={i} className={cn('min-w-0', it.className)}>
          <dt className="text-xs text-muted-foreground">{it.label}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, actions, className, description }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; description?: ReactNode }) {
  return (
    <Card className={className}>
      {title ? (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </Card>
  );
}

export const HintBanner = React.memo(function HintBanner({ text, className }: { text: string; className?: string }) {
  return <div className={cn('mb-3 rounded-md border border-dashed border-warning/60 bg-warning/5 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300', className)}>{text}</div>;
});
