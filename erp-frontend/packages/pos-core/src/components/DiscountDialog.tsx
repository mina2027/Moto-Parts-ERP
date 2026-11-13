import * as React from 'react';
import { round2 } from '@moto/shared';
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from '@moto/ui';
import { usePosT } from '../i18n';

export interface DiscountDialogProps {
  title: string;
  base: number;
  maxAmount: number;
  initialValue: number;
  formatMoney: (amount: number) => string;
  onClose: () => void;
  onApply: (value: number, mode: 'amount') => void;
}

export function DiscountDialog({ title, base, maxAmount, initialValue, formatMoney, onClose, onApply }: DiscountDialogProps) {
  const { p } = usePosT();
  const [value, setValue] = React.useState(String(initialValue));
  const numeric = Number(value);
  const amount = round2(numeric);
  const valid = value.trim() !== '' && Number.isFinite(numeric) && numeric >= 0 && amount <= maxAmount && amount <= base;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <form onSubmit={(event) => { event.preventDefault(); if (valid) onApply(numeric, 'amount'); }}>
          <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{p.discountHint}</DialogDescription></DialogHeader>
          <div className="my-4 space-y-3">
            <label className="block text-sm">{p.discountValue}
              <Input type="number" min="0" max={maxAmount} step="0.01" value={value} onChange={(event) => setValue(event.target.value)} autoFocus data-scanner-ignore className="mt-1 num" />
            </label>
            <div className="flex justify-between text-sm"><span>{p.max}</span><span className="num">{formatMoney(maxAmount)}</span></div>
            <div className="flex justify-between text-sm"><span>{p.discount}</span><span className="num">{formatMoney(Number.isFinite(amount) ? amount : 0)}</span></div>
            {!valid ? <Alert variant="destructive">{p.discountExceeds}</Alert> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onApply(0, 'amount')}>{p.removeDiscount}</Button>
            <Button type="submit" disabled={!valid}>{p.applyDiscount}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
