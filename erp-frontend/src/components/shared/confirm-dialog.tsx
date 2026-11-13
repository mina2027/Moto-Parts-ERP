import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive' | 'warning' | 'success';
  onConfirm: () => void | Promise<void>;
  children?: React.ReactNode;
  loading?: boolean;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmText, cancelText, variant = 'default', onConfirm, children, loading }: ConfirmDialogProps) {
  const { t } = useT();
  const [busy, setBusy] = React.useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {variant !== 'default' ? (
              <div className={variant === 'destructive' ? 'rounded-full bg-destructive/10 p-2 text-destructive' : variant === 'warning' ? 'rounded-full bg-warning/10 p-2 text-amber-600' : 'rounded-full bg-success/10 p-2 text-success'}>
                <AlertTriangle className="size-5" />
              </div>
            ) : null}
            <div className="space-y-1">
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>
          </div>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{cancelText ?? t('common.cancel')}</Button>
          <Button variant={variant === 'destructive' ? 'destructive' : variant === 'warning' ? 'warning' : variant === 'success' ? 'success' : 'default'} onClick={handle} loading={busy || loading}>
            {confirmText ?? t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Imperative confirm hook: const confirm = useConfirm(); await confirm({...}) */
export function useConfirm() {
  const [state, setState] = React.useState<(Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm'> & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = React.useCallback((opts: Omit<ConfirmDialogProps, 'open' | 'onOpenChange' | 'onConfirm'>) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })), []);
  const dialog = state ? (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) { state.resolve(false); setState(null); } }}
      title={state.title}
      description={state.description}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      variant={state.variant}
      onConfirm={() => { state.resolve(true); setState(null); }}
    >
      {state.children}
    </ConfirmDialog>
  ) : null;
  return { confirm, dialog };
}
