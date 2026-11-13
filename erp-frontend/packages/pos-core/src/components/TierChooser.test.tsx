import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, allowedPriceTiers } from '@moto/shared';
import { TierChooser } from './TierChooser';

const prices = { retail1: 100, retail2: 90, wholesale: 80 };
const price = (n: number) => new RegExp(`^${n}\\s`);

function mount(over: Partial<React.ComponentProps<typeof TierChooser>> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <TierChooser open onOpenChange={onOpenChange} prices={prices} current="retail1" settings={DEFAULT_SETTINGS} allowedTiers={allowedPriceTiers(true)} onPick={onPick} {...over}>
      <button type="button">anchor</button>
    </TierChooser>,
  );
  return { onPick, onOpenChange };
}

describe('TierChooser', () => {
  it('renders the three tier prices and picks by click', () => {
    const { onPick, onOpenChange } = mount();
    expect(screen.getByText(price(100))).toBeTruthy();
    expect(screen.getByText(price(90))).toBeTruthy();
    expect(screen.getByText(price(80))).toBeTruthy();
    fireEvent.click(screen.getByText(price(80)).closest('button')!);
    expect(onPick).toHaveBeenCalledWith('wholesale', 80);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keyboard digits pick the tier at that position', () => {
    const { onPick } = mount();
    fireEvent.keyDown(window, { key: '2' });
    expect(onPick).toHaveBeenCalledWith('retail2', 90);
  });

  it('without wholesale permission that tier is neither rendered nor reachable by keyboard', () => {
    const { onPick } = mount({ allowedTiers: allowedPriceTiers(false) });
    fireEvent.keyDown(window, { key: '3' });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryAllByText(price(80))).toHaveLength(0);
  });

  it('shows the special price option when provided', () => {
    const { onPick } = mount({ specialPrice: 70 });
    fireEvent.click(screen.getByText(price(70)).closest('button')!);
    expect(onPick).toHaveBeenCalledWith('special', 70);
  });
});
