import * as React from 'react';
import { FileText, ReceiptText } from 'lucide-react';
import { usePosT } from '../i18n';
import type { InvoiceSize } from '../print/profiles';

export function InvoiceSizeSelector({ value, onChange, disabled }: { value: InvoiceSize; onChange: (size: InvoiceSize) => void; disabled?: boolean }) {
  const { p } = usePosT();
  const name = React.useId();
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{p.invoiceSize}</legend>
      <div className="grid grid-cols-2 gap-2">
        {([{ size: 'small', label: p.smallInvoice, paper: '80mm', Icon: ReceiptText }, { size: 'large', label: p.largeInvoice, paper: 'A4', Icon: FileText }] as const).map(({ size, label, paper, Icon }) => (
          <label key={size} className="cursor-pointer">
            <input type="radio" name={name} value={size} checked={value === size} onChange={() => onChange(size)} className="peer sr-only" />
            <span className="flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50">
              <Icon className="size-5" />{label} <span dir="ltr">{paper}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
