import { useCallback } from 'react';
import { ar } from './ar';
import { en, type Translations } from './en';
import { useUiStore } from '@/stores/uiStore';
import type { Locale, LocalizedText } from '@/types';

export const translations: Record<Locale, Translations> = { ar, en };

type PathKeys<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : PathKeys<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = PathKeys<Translations>;

function getPath(obj: unknown, path: string): string | undefined {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj) as string | undefined;
}

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let s = getPath(translations[locale], key) ?? getPath(translations.en, key) ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function useT() {
  const locale = useUiStore((s) => s.locale);
  const t = useCallback((key: TKey | (string & {}), vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
  const tx = useCallback((text: LocalizedText | undefined | null) => (text ? text[locale] || text.en || text.ar : ''), [locale]);
  return { t, tx, locale, isRtl: locale === 'ar', dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) };
}
