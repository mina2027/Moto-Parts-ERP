import * as React from 'react';
import { Button } from '@moto/ui';
import { Minus, Plus, Type } from 'lucide-react';
import { usePosT } from '@moto/pos-core';

const KEY = 'pos.fontSize';
const MIN = 80;
const MAX = 140;
const STEP = 5;

export function useFontSize() {
  const [size, setSize] = React.useState(() => {
    try {
      const stored = Number(localStorage.getItem(KEY));
      return Number.isFinite(stored) && stored >= MIN && stored <= MAX ? Math.round(stored / STEP) * STEP : 100;
    } catch {
      return 100;
    }
  });
  React.useEffect(() => {
    const root = document.documentElement;
    const previousSize = root.style.fontSize;
    const previousScale = root.style.getPropertyValue('--ui-font-scale');
    return () => {
      root.style.fontSize = previousSize;
      if (previousScale) root.style.setProperty('--ui-font-scale', previousScale);
      else root.style.removeProperty('--ui-font-scale');
    };
  }, []);
  React.useEffect(() => {
    document.documentElement.style.fontSize = `${16 * size / 100}px`;
    document.documentElement.style.setProperty('--ui-font-scale', String(size / 100));
    try {
      localStorage.setItem(KEY, String(size));
    } catch {
      // Keep the current size when device storage is unavailable.
    }
  }, [size]);
  return { size, setSize: (value: number) => setSize(Math.min(MAX, Math.max(MIN, value))) };
}

export function FontSizeControl({ size, setSize }: ReturnType<typeof useFontSize>) {
  const { p } = usePosT();
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-md border px-1" role="group" aria-label={p.fontSize}>
      <Type className="size-3.5" aria-hidden="true" />
      <span className="text-xs">{p.fontSize}</span>
      <Button size="icon-xs" variant="ghost" disabled={size <= MIN} onClick={() => setSize(size - STEP)} aria-label={p.decreaseFont}><Minus /></Button>
      <input type="range" min={MIN} max={MAX} step={STEP} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label={p.fontSize} className="w-20 cursor-pointer accent-primary" dir="ltr" />
      <Button size="icon-xs" variant="ghost" disabled={size >= MAX} onClick={() => setSize(size + STEP)} aria-label={p.increaseFont}><Plus /></Button>
      <button type="button" className="num min-w-10 rounded px-1 text-xs hover:bg-accent" onClick={() => setSize(100)} title={p.resetFont} aria-label={p.resetFont}>{size}%</button>
    </div>
  );
}
