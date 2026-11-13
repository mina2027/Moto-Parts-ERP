import { describe, expect, it } from 'vitest';
import { defaultPrintProfiles, type PrintProfile } from '@moto/shared';
import { availablePrintProfiles, invoiceProfileForSize, profileForSize } from './profiles';

describe('invoice size selection', () => {
  const legacyProfile = (paper: 'thermal58' | 'a5'): PrintProfile => ({
    ...defaultPrintProfiles().find(p => p.paper === (paper === 'a5' ? 'a4' : 'thermal80'))!,
    id: `pp-${paper}`, paper,
  } as unknown as PrintProfile);
  it('makes thermal and A4 printing available with no server profiles', () => {
    expect(profileForSize([], 'small', null).paper).toBe('thermal80');
    expect(profileForSize([], 'large', null).paper).toBe('a4');
  });

  it('replaces the selected 58mm layout while preserving its printer', () => {
    const profiles = [legacyProfile('thermal58')];
    profiles[0].printerName = 'Receipt printer';
    expect(profileForSize(profiles, 'small', 'pp-thermal58')).toMatchObject({ paper: 'thermal80', printerName: 'Receipt printer' });
    expect(profiles.find((p) => p.id === 'pp-thermal58')!.paper).toBe('thermal58');
  });

  it('uses 80mm when the server only supplies a legacy 58mm profile', () => {
    expect(profileForSize([legacyProfile('thermal58')], 'small', null).paper).toBe('thermal80');
  });

  it('normalizes cached adapter profiles to the two supported sizes', () => {
    expect(invoiceProfileForSize(legacyProfile('thermal58'), 'small').paper).toBe('thermal80');
    expect(invoiceProfileForSize(legacyProfile('a5'), 'large').paper).toBe('a4');
  });

  it('uses A4 for the large button even when a thermal profile is the device default', () => {
    expect(profileForSize(defaultPrintProfiles(), 'large', 'pp-thermal58').paper).toBe('a4');
  });

  it('uses a thermal receipt for the small button even when A4 is the device default', () => {
    expect(profileForSize(defaultPrintProfiles(), 'small', 'pp-a4').paper).toBe('thermal80');
  });

  it('does not change server profiles when supplying a missing size', () => {
    const profiles = [legacyProfile('a5')];
    expect(availablePrintProfiles(profiles)).toHaveLength(2);
    expect(profiles).toHaveLength(1);
  });
});
