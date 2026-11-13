import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useT } from '@/i18n';
import { formatMoney, formatNumber } from '@/lib/utils';
import type { NamedValue, TimeSeriesPoint } from '@/types';

const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#9333ea', '#0891b2', '#ea580c', '#64748b', '#be185d', '#4f46e5'];

function useChartTheme() {
  return { grid: 'hsl(var(--border))', text: 'hsl(var(--muted-foreground))', tooltipBg: 'hsl(var(--popover))', tooltipBorder: 'hsl(var(--border))' };
}

function MoneyTooltip({ active, payload, label, locale }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; locale: 'ar' | 'en' }) {
  const th = useChartTheme();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border px-2.5 py-1.5 text-xs shadow-md" style={{ background: th.tooltipBg, borderColor: th.tooltipBorder }}>
      {label ? <div className="mb-1 font-medium">{label}</div> : null}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ms-auto num font-medium">{formatMoney(p.value, locale, { decimals: 0 })}</span>
        </div>
      ))}
    </div>
  );
}

const shortDate = (d: string) => d.slice(5).replace('-', '/');
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${formatNumber(v / 1000, 0)}k` : formatNumber(v));

export function SalesProfitChart({ data, height = 260, keys = ['sales', 'profit'] }: { data: TimeSeriesPoint[]; height?: number; keys?: ('sales' | 'profit' | 'purchases' | 'expenses')[] }) {
  const { t, locale, isRtl } = useT();
  const th = useChartTheme();
  const names: Record<string, string> = { sales: t('dashboard.todaySales').replace(t('common.today'), '').trim() || t('common.revenue'), profit: t('common.profit'), purchases: t('dashboard.purchases'), expenses: t('dashboard.expenses') };
  const colors: Record<string, string> = { sales: '#2563eb', profit: '#16a34a', purchases: '#f59e0b', expenses: '#dc2626' };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {keys.map((k) => (
            <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors[k]} stopOpacity={0.25} />
              <stop offset="95%" stopColor={colors[k]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={th.grid} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} reversed={isRtl} />
        <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} width={44} orientation={isRtl ? 'right' : 'left'} />
        <Tooltip content={<MoneyTooltip locale={locale} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k) => (
          <Area key={k} type="monotone" dataKey={k} name={names[k]} stroke={colors[k]} fill={`url(#g-${k})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SimpleLineChart({ data, dataKey, name, color = '#2563eb', height = 200 }: { data: TimeSeriesPoint[]; dataKey: keyof TimeSeriesPoint; name: string; color?: string; height?: number }) {
  const { locale, isRtl } = useT();
  const th = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={th.grid} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} reversed={isRtl} />
        <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} width={44} orientation={isRtl ? 'right' : 'left'} />
        <Tooltip content={<MoneyTooltip locale={locale} />} />
        <Line type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function NamedBarChart({ data, height = 240, horizontal, color }: { data: NamedValue[]; height?: number; horizontal?: boolean; color?: string }) {
  const { tx, locale, isRtl } = useT();
  const th = useChartTheme();
  const rows = data.map((d, i) => ({ name: tx(d.name), value: d.value, color: d.color ?? color ?? PALETTE[i % PALETTE.length] }));
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={th.grid} horizontal={false} />
          <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} reversed={isRtl} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} orientation={isRtl ? 'right' : 'left'} />
          <Tooltip content={<MoneyTooltip locale={locale} />} cursor={{ fill: 'hsl(var(--muted))' }} />
          <Bar dataKey="value" name="" radius={[0, 3, 3, 0]} maxBarSize={22}>
            {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={th.grid} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} reversed={isRtl} interval={0} />
        <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: th.text }} axisLine={false} tickLine={false} width={44} orientation={isRtl ? 'right' : 'left'} />
        <Tooltip content={<MoneyTooltip locale={locale} />} cursor={{ fill: 'hsl(var(--muted))' }} />
        <Bar dataKey="value" name="" radius={[3, 3, 0, 0]} maxBarSize={36}>
          {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, height = 220, money = true }: { data: NamedValue[]; height?: number; money?: boolean }) {
  const { tx, locale } = useT();
  const th = useChartTheme();
  const rows = data.map((d, i) => ({ name: tx(d.name), value: d.value, color: d.color ?? PALETTE[i % PALETTE.length] }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="h-full shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2} stroke="none">
              {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
            </Pie>
            <Tooltip formatter={(v: number) => (money ? formatMoney(v, locale, { decimals: 0 }) : formatNumber(v))} contentStyle={{ background: th.tooltipBg, borderColor: th.tooltipBorder, fontSize: 12, borderRadius: 6 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
            <span className="truncate text-muted-foreground">{r.name}</span>
            <span className="ms-auto num font-medium">{total ? Math.round((r.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const ChartCard = React.memo(function ChartCard({ title, children, actions, className }: { title: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border bg-card ${className ?? ''}`}>
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
});
