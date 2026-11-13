import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, differenceInDays, parseISO } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
import type { Locale } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

let idCounter = 1000;
export function uid(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function formatMoney(value: number, locale: Locale = 'ar', opts?: { compact?: boolean; decimals?: number }): string {
  const decimals = opts?.decimals ?? 2;
  const n = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: opts?.compact ? 'compact' : 'standard',
  }).format(value);
  return locale === 'ar' ? `${n} ج.م` : `EGP ${n}`;
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${formatNumber(value, decimals)}%`;
}

export function formatDate(iso: string | Date | null | undefined, locale: Locale = 'ar', pattern = 'dd/MM/yyyy'): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? parseISO(iso) : iso;
  return format(d, pattern, { locale: locale === 'ar' ? arLocale : enUS });
}

export function formatDateTime(iso: string | Date | null | undefined, locale: Locale = 'ar'): string {
  return formatDate(iso, locale, 'dd/MM/yyyy HH:mm');
}

export function formatTime(iso: string | Date | null | undefined, locale: Locale = 'ar'): string {
  return formatDate(iso, locale, 'HH:mm');
}

export function timeAgo(iso: string | Date, locale: Locale = 'ar'): string {
  const d = typeof iso === 'string' ? parseISO(iso) : iso;
  return formatDistanceToNow(d, { addSuffix: true, locale: locale === 'ar' ? arLocale : enUS });
}

export function daysBetween(from: string, to: string | Date = new Date()): number {
  return differenceInDays(typeof to === 'string' ? parseISO(to) : to, parseISO(from));
}

export function daysOverdue(dueDate: string): number {
  return Math.max(0, daysBetween(dueDate));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sum<T>(arr: T[], pick: (x: T) => number): number {
  return arr.reduce((acc, x) => acc + pick(x), 0);
}

export function groupBy<T, K extends string | number>(arr: T[], key: (x: T) => K): Record<K, T[]> {
  return arr.reduce((acc, x) => {
    const k = key(x);
    (acc[k] ||= []).push(x);
    return acc;
  }, {} as Record<K, T[]>);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function paginate<T>(arr: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return arr.slice(start, start + pageSize);
}

export function matchSearch(haystack: (string | number | undefined | null)[], q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return haystack.some((h) => h != null && String(h).toLowerCase().includes(needle));
}

export function sortBy<T>(arr: T[], key: keyof T | ((x: T) => unknown), dir: 'asc' | 'desc' = 'asc'): T[] {
  const pick = typeof key === 'function' ? key : (x: T) => x[key];
  return [...arr].sort((a, b) => {
    const av = pick(a) as string | number;
    const bv = pick(b) as string | number;
    if (av === bv) return 0;
    const r = av > bv ? 1 : -1;
    return dir === 'asc' ? r : -r;
  });
}

export function todayISO(): string {
  return new Date().toISOString();
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function isSameDay(a: string, b: string | Date = new Date()): boolean {
  const da = parseISO(a);
  const db = typeof b === 'string' ? parseISO(b) : b;
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}
