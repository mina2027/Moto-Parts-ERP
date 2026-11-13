import * as React from 'react';
import type { Customer, CustomerType } from '@moto/shared';
import { matchSearch } from '@moto/shared';
import type { CustomerSaveInput } from '@moto/shared';
import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, cn } from '@moto/ui';
import { UserPlus, UserX } from 'lucide-react';
import { formatMoney, usePosT } from '../i18n';

export interface CustomerPickerProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customers: Customer[];
  onSelect: (c: Customer | null) => void;
  onCreate?: (input: CustomerSaveInput) => Promise<Customer>;
  currencySymbol: { ar: string; en?: string };
}

export function CustomerPicker({ open, onOpenChange, customers, onSelect, onCreate, currencySymbol }: CustomerPickerProps) {
  const { p, tx, locale } = usePosT();
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', phone: '', type: 'retail' as CustomerType });
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const list = React.useMemo(() => customers.filter((c) => c.isActive && matchSearch([c.name.ar, c.name.en, c.phone, c.code, c.whatsapp], q)).slice(0, 30), [customers, q]);
  React.useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setCreating(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const submitCreate = async () => {
    if (!onCreate || !form.name.trim() || form.phone.trim().length < 5) return;
    setBusy(true);
    try {
      const c = await onCreate({ name: { ar: form.name.trim() }, phone: form.phone.trim(), type: form.type, creditLimit: 0, isActive: true });
      onSelect(c);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{p.customers}</DialogTitle></DialogHeader>
        {creating ? (
          <div className="space-y-3">
            <Input placeholder={p.name} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            <Input placeholder={p.phone} dir="ltr" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <div className="inline-flex rounded-md border p-0.5">
              {(['retail', 'wholesale', 'workshop'] as CustomerType[]).map((t) => (
                <Button key={t} type="button" size="xs" variant={form.type === t ? 'secondary' : 'ghost'} onClick={() => setForm((f) => ({ ...f, type: t }))}>{p.types[t]}</Button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>{p.cancel}</Button>
              <Button type="button" loading={busy} onClick={submitCreate}>{p.save}</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setIdx(0); }}
                placeholder={`${p.search}… (${p.name} / ${p.phone} / ${p.code})`}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
                  else if (e.key === 'Enter') { e.preventDefault(); const c = list[idx]; if (c) { onSelect(c); onOpenChange(false); } }
                }}
              />
              <Button type="button" variant="outline" onClick={() => { onSelect(null); onOpenChange(false); }}><UserX /> {p.walkIn}</Button>
              {onCreate ? <Button type="button" variant="secondary" onClick={() => setCreating(true)}><UserPlus /> {p.newCustomer}</Button> : null}
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              {list.map((c, i) => (
                <button key={c.id} type="button" onMouseEnter={() => setIdx(i)} onClick={() => { onSelect(c); onOpenChange(false); }} className={cn('flex w-full items-center gap-3 border-b px-3 py-2 text-start last:border-0', i === idx && 'bg-accent')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{tx(c.name)}</div>
                    <div className="num text-[11px] text-muted-foreground">{c.code} · {c.phone}</div>
                  </div>
                  <Badge variant="outline">{p.types[c.type]}</Badge>
                  {c.balance > 0 ? <span className="num text-xs text-amber-600">{formatMoney(c.balance, locale, currencySymbol, 0)}</span> : null}
                </button>
              ))}
              {!list.length ? <div className="py-8 text-center text-sm text-muted-foreground">—</div> : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
