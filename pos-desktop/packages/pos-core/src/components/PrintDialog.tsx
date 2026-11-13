import * as React from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@moto/ui';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { usePosT } from '../i18n';
import { InvoiceSizeSelector } from './InvoiceSizeSelector';
import type { InvoiceSize } from '../print/profiles';

export interface PrintDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialSize?: InvoiceSize;
  title?: string;
  onPrint: (size: InvoiceSize) => Promise<void>;
}

/** Every invoice print or reprint explicitly offers the same two paper sizes. */
export function PrintDialog({ open, onOpenChange, initialSize = 'small', title, onPrint }: PrintDialogProps) {
  const { p } = usePosT();
  const [size, setSize] = React.useState<InvoiceSize>(initialSize);
  const [busy, setBusy] = React.useState(false);
  const printing = React.useRef(false);
  React.useEffect(() => {
    if (open) setSize(initialSize);
  }, [open, initialSize]);

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!printing.current) onOpenChange(value); }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>{title ?? p.print}</DialogTitle></DialogHeader>
        <InvoiceSizeSelector value={size} onChange={setSize} disabled={busy} />
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{p.close}</Button>
          <Button
            disabled={busy}
            loading={busy}
            onClick={async () => {
              if (printing.current) return;
              printing.current = true;
              setBusy(true);
              try {
                await onPrint(size);
                onOpenChange(false);
              } catch (error) {
                toast.error(p.printFailed, { description: error instanceof Error ? error.message : String(error) });
              } finally {
                printing.current = false;
                setBusy(false);
              }
            }}
          >
            <Printer /> {p.print}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
