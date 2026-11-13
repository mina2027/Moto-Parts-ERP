/** The invoice canvas and page have identical dimensions; padding belongs inside the design. */
export function invoicePageMarginMm(_widthMm: number): number {
  return 0;
}

export function invoiceContentWidthMm(widthMm: number): number {
  return widthMm - invoicePageMarginMm(widthMm) * 2;
}

/** Round the content length up, with 4mm of paper feed after the design for the cutter. */
export function invoiceRollHeightMm(contentHeightPx: number, _widthMm: number): number {
  const height = Number.isFinite(contentHeightPx) && contentHeightPx > 0 ? contentHeightPx * 25.4 / 96 : 0;
  return Math.max(30, Math.ceil(height + 4));
}
