import * as React from 'react';
import QRCode from 'qrcode';
import { cn } from './cn';

export interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  level?: 'L' | 'M' | 'Q' | 'H';
}

/** Renders a QR as an inline SVG string (works for print and Electron). */
export function QrCode({ value, size = 96, className, level = 'M' }: QrCodeProps) {
  const [svg, setSvg] = React.useState<string>('');
  React.useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', errorCorrectionLevel: level, margin: 0, width: size })
      .then((s) => {
        if (!cancelled) setSvg(s);
      })
      .catch(() => {
        if (!cancelled) setSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, level]);
  if (!svg) return <div className={cn('bg-muted', className)} style={{ width: size, height: size }} aria-hidden />;
  return <div className={cn('inline-block [&>svg]:h-full [&>svg]:w-full', className)} style={{ width: size, height: size }} role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: svg }} />;
}
