import * as React from 'react';
import { cn } from './cn';

// Code 128 patterns (widths of 6 elements: bar, space, bar, space, bar, space) for symbols 0..106.
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Encodes value using Code 128 B/C auto-switching; returns module widths with alternating bar/space. */
export function encodeCode128(value: string): { widths: number[]; valid: boolean } {
  const chars = Array.from(value);
  if (!chars.length || chars.some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) return { widths: [], valid: false };

  const codes: number[] = [];
  let i = 0;
  let mode: 'B' | 'C' | null = null;
  const digitsAhead = (from: number) => {
    let n = 0;
    while (from + n < chars.length && /\d/.test(chars[from + n]!)) n++;
    return n;
  };
  while (i < chars.length) {
    const d = digitsAhead(i);
    if (d >= 4 || (d >= 2 && i + d === chars.length && mode === 'C')) {
      if (mode !== 'C') {
        codes.push(mode === null ? START_C : CODE_C);
        mode = 'C';
      }
      const pairs = Math.floor(d / 2);
      for (let p = 0; p < pairs; p++) {
        codes.push(Number(chars[i]! + chars[i + 1]!));
        i += 2;
      }
    } else {
      if (mode !== 'B') {
        codes.push(mode === null ? START_B : CODE_B);
        mode = 'B';
      }
      codes.push(chars[i]!.charCodeAt(0) - 32);
      i++;
    }
  }
  let checksum = codes[0]!;
  for (let k = 1; k < codes.length; k++) checksum += codes[k]! * k;
  codes.push(checksum % 103, STOP);

  const widths: number[] = [];
  for (const c of codes) for (const w of CODE128_PATTERNS[c]!) widths.push(Number(w));
  return { widths, valid: true };
}

export interface BarcodeProps {
  value: string;
  height?: number;
  showText?: boolean;
  className?: string;
  /** Width in px of a single module. */
  barWidth?: number;
  fontSize?: number;
  /** When true the SVG stretches to its container width (for label designer). */
  fluid?: boolean;
}

export const Barcode = React.memo(function Barcode({ value, height = 40, showText = true, className, barWidth = 1.6, fontSize = 9, fluid = false }: BarcodeProps) {
  const { widths, valid } = React.useMemo(() => encodeCode128(value), [value]);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const w = total * barWidth;
  const textH = showText ? fontSize + 4 : 0;
  const rects: React.ReactNode[] = [];
  let x = quiet;
  widths.forEach((mw, idx) => {
    if (idx % 2 === 0) rects.push(<rect key={idx} x={x * barWidth} y={0} width={mw * barWidth} height={height} fill="currentColor" />);
    x += mw;
  });
  if (!valid) return <span className={cn('text-xs text-destructive', className)}>{value || '—'}</span>;
  return (
    <svg
      viewBox={`0 0 ${w} ${height + textH}`}
      width={fluid ? '100%' : w}
      height={fluid ? '100%' : height + textH}
      preserveAspectRatio={fluid ? 'xMidYMid meet' : undefined}
      className={cn('max-w-full', className)}
      role="img"
      aria-label={value}
      style={{ direction: 'ltr' }}
      shapeRendering="crispEdges"
    >
      {rects}
      {showText ? (
        <text x={w / 2} y={height + fontSize} textAnchor="middle" fontSize={fontSize} fontFamily="monospace" fill="currentColor" letterSpacing={1}>
          {value}
        </text>
      ) : null}
    </svg>
  );
});
