import * as React from 'react';
import type { AppSettings, LabelElement, LabelTemplate, Product } from '@/types';
import { mmToPx } from '@moto/shared';
import { Barcode } from '@/components/shared/barcode';
import { cn, formatMoney } from '@/lib/utils';
import { useT } from '@/i18n';

export interface LabelRendererProps {
  template: LabelTemplate;
  product: Product;
  settings: AppSettings;
  /** Preview pixels per mm. Omit for physical mm dimensions when printing. */
  scale?: number;
  className?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMove?: (id: string, dxMm: number, dyMm: number) => void;
  onResize?: (id: string, dwMm: number, dhMm: number) => void;
  interactive?: boolean;
  showGrid?: boolean;
  /** Pre-formatted "rack · bin" for the current branch; drives the `location` element. */
  location?: string;
}

/** Renders one label at exact mm dimensions. Interactive mode enables drag/resize for the designer. */
export function LabelRenderer({ template, product, settings, scale, className, selectedId, onSelect, onMove, onResize, interactive, showGrid, location }: LabelRendererProps) {
  const { tx, locale } = useT();
  // Browsers use 96 CSS px/inch regardless of the printer's hardware DPI.
  const pxPerMm = scale ?? mmToPx(1, 96);
  const px = (mm: number) => mm * pxPerMm;
  const dimension = (mm: number) => scale == null ? `${mm}mm` : px(mm);
  const drag = React.useRef<{ id: string; mode: 'move' | 'resize'; x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, id: string, mode: 'move' | 'resize') => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, mode, x: e.clientX, y: e.clientY };
    onSelect?.(id);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / pxPerMm;
    const dy = (e.clientY - d.y) / pxPerMm;
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    if (d.mode === 'move') onMove?.(d.id, dx, dy);
    else onResize?.(d.id, dx, dy);
  };
  const onPointerUp = () => (drag.current = null);

  const text = (el: LabelElement): string => {
    switch (el.type) {
      case 'companyName':
        return tx(settings.company.name);
      case 'productName':
        return tx(product.name);
      case 'price':
        return formatMoney(product.prices[el.priceTier ?? 'retail1'], locale, { decimals: 0 });
      case 'sku':
        return product.sku;
      case 'partNumber':
        return product.partNumber;
      case 'location':
        return location ?? '';
      case 'customText':
        return el.text ?? '';
      default:
        return '';
    }
  };

  return (
    <div
      className={cn('relative overflow-hidden bg-white text-black', className)}
      style={{ width: dimension(template.widthMm), height: dimension(template.heightMm), backgroundImage: showGrid ? `linear-gradient(to right, #eee 1px, transparent 1px), linear-gradient(to bottom, #eee 1px, transparent 1px)` : undefined, backgroundSize: showGrid ? `${px(1)}px ${px(1)}px` : undefined }}
      dir="ltr"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {template.elements
        .filter((el) => el.visible)
        .map((el) => {
          const selected = selectedId === el.id;
          const style: React.CSSProperties = {
            position: 'absolute',
            left: dimension(el.x),
            top: dimension(el.y),
            width: dimension(el.w),
            height: dimension(el.h),
            fontSize: scale == null ? `${el.fontSize}pt` : px(el.fontSize * 0.3528),
            fontWeight: el.fontWeight,
            textAlign: el.align === 'start' ? 'left' : el.align === 'end' ? 'right' : 'center',
            lineHeight: 1.1,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: el.align === 'start' ? 'flex-start' : el.align === 'end' ? 'flex-end' : 'center',
            fontFamily: "Inter, 'Noto Sans Arabic', Tahoma, sans-serif",
          };
          return (
            <div
              key={el.id}
              style={style}
              className={cn(interactive && 'cursor-move', interactive && selected && 'outline outline-1 outline-blue-500', interactive && !selected && 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-gray-400')}
              onPointerDown={(e) => onPointerDown(e, el.id, 'move')}
            >
              {el.type === 'barcode' ? (
                <div className="flex h-full w-full items-center justify-center">
                  <Barcode value={product.internalBarcode} height={px(el.h) * 0.62} fontSize={Math.max(6, px(el.fontSize * 0.3528))} barWidth={Math.max(0.6, px(el.w) / 220)} fluid />
                </div>
              ) : el.type === 'logo' ? (
                settings.company.logoUrl ? <img src={settings.company.logoUrl} alt="" className="max-h-full max-w-full object-contain" draggable={false} /> : <span className="text-[8px] text-gray-400">LOGO</span>
              ) : (
                <span className="w-full truncate" dir="auto">{text(el)}</span>
              )}
              {interactive && selected ? <div onPointerDown={(e) => onPointerDown(e, el.id, 'resize')} className="absolute -bottom-1 -right-1 size-2.5 cursor-nwse-resize rounded-sm bg-blue-500" /> : null}
            </div>
          );
        })}
    </div>
  );
}

/** Styles for exact-size label printing (one label per page). */
export function labelPageStyle(t: LabelTemplate) {
  return `@page { size: ${t.widthMm}mm ${t.heightMm}mm; margin: 0; }
    @media print {
      html, body { width: ${t.widthMm}mm !important; height: auto !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: white !important; }
      body > :not(.barcode-print-document) { display: none !important; }
      .barcode-print-document, .barcode-print-document * { visibility: visible !important; }
      .barcode-print-document { position: static !important; display: block !important; width: ${t.widthMm}mm !important; height: auto !important; margin: 0; padding: 0; overflow: visible !important; }
      .barcode-print-document .label-page { display: block; width: ${t.widthMm}mm; height: ${t.heightMm}mm; margin: 0; padding: 0; overflow: hidden; break-inside: avoid; page-break-inside: avoid; break-after: page; page-break-after: always; }
      .barcode-print-document .label-page:last-child { break-after: auto; page-break-after: auto; }
    }`;
}
