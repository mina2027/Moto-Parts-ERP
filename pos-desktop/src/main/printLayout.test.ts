import { describe, expect, it } from 'vitest';
import { buildPrintDocument, clampScale, isSilentPref, MIN_ROLL_HEIGHT_MM, parseScalePref, pickPrinterName, previewWindowSize, printLayoutFor, PX_PER_MM, ROLL_TAIL_MM, rollPageHeightMm } from './printLayout';

describe('checkout print dimensions', () => {
  it('prints the full paper width at 100% without changing label dimensions', () => {
    const receipt = buildPrintDocument('<div class="invoice"></div>', 80, null, 1.5, true);
    expect(receipt).toContain('margin: 0mm');
    expect(receipt).toContain('width: 80mm');
    expect(receipt).toContain('zoom: 1;');
    const sheet = buildPrintDocument('<div class="invoice"></div>', 210, 297, 0.5, true);
    expect(sheet).toContain('size: 210mm 297mm; margin: 0mm;');
    expect(sheet).toContain('width: 210mm');
    expect(sheet).toContain('zoom: 1;');
    expect(buildPrintDocument('<div>label</div>', 50, 25, 1)).toContain('margin: 0mm');
  });
  it('replaces old 58mm jobs and custom scale with an 80mm roll at 100%', () => {
    expect(printLayoutFor({ profileId: 'invoice-small', widthMm: 58, heightMm: 200, scale: 0.9 }))
      .toEqual({ widthMm: 80, heightMm: null, scale: 1 });
  });

  it('replaces old A5 jobs and custom scale with portrait A4 at 100%', () => {
    expect(printLayoutFor({ profileId: 'invoice-large', widthMm: 148, heightMm: 210, scale: 1.2 }))
      .toEqual({ widthMm: 210, heightMm: 297, scale: 1 });
  });

  it('preserves custom sizes for other print jobs such as barcode labels', () => {
    expect(printLayoutFor({ widthMm: 50, heightMm: 25, scale: 0.95 }))
      .toEqual({ widthMm: 50, heightMm: 25, scale: 0.95 });
  });
});

describe('previewWindowSize', () => {
  it('keeps a thermal receipt window usable instead of 219px wide', () => {
    expect(previewWindowSize(58, null).width).toBe(420);
  });
  it('tracks the paper for full-size sheets', () => {
    expect(previewWindowSize(210, 297).width).toBe(Math.round(210 * PX_PER_MM));
  });
  it('caps a long roll so the dialog owner still fits on screen', () => {
    expect(previewWindowSize(80, 1200).height).toBe(860);
  });
});

describe('rollPageHeightMm', () => {
  it('sizes the page to the content plus a cutter tail', () => {
    const px = 200 * PX_PER_MM;
    expect(rollPageHeightMm(px)).toBe(200 + ROLL_TAIL_MM);
  });
  it('keeps long receipts on a single page instead of a fixed 240mm', () => {
    expect(rollPageHeightMm(1500 * PX_PER_MM)).toBeGreaterThan(1500);
  });
  it('never goes below the minimum page height', () => {
    expect(rollPageHeightMm(0)).toBe(MIN_ROLL_HEIGHT_MM);
    expect(rollPageHeightMm(Number.NaN)).toBe(MIN_ROLL_HEIGHT_MM);
  });
});

describe('scale', () => {
  it('clamps to a sane range and defaults to 100%', () => {
    expect(clampScale(undefined)).toBe(1);
    expect(clampScale(0)).toBe(1);
    expect(clampScale(0.1)).toBe(0.5);
    expect(clampScale(3)).toBe(1.5);
    expect(clampScale(0.9)).toBe(0.9);
  });
  it('parses stored percentages', () => {
    expect(parseScalePref('95')).toBe(0.95);
    expect(parseScalePref(null)).toBe(1);
    expect(parseScalePref('abc')).toBe(1);
    expect(parseScalePref('400')).toBe(1.5);
  });
});

describe('pickPrinterName', () => {
  it('prefers the printer chosen on this device', () => {
    expect(pickPrinterName('XP-80C', 'EPSON TM-T20')).toBe('XP-80C');
  });
  it('falls back to the profile printer, then to the OS default (null)', () => {
    expect(pickPrinterName(null, 'EPSON TM-T20')).toBe('EPSON TM-T20');
    expect(pickPrinterName('  ', '')).toBeNull();
  });
});

describe('isSilentPref', () => {
  it('is on unless explicitly disabled', () => {
    expect(isSilentPref(null)).toBe(true);
    expect(isSilentPref('1')).toBe(true);
    expect(isSilentPref('0')).toBe(false);
  });
});
