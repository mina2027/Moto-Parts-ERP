import { cn } from '@/lib/utils';

export function DeveloperCredit({ className }: { className?: string }) {
  return (
    <footer dir="ltr" className={cn('shrink-0 text-center text-xs text-muted-foreground print:hidden', className)}>
      Developed by Mina Magdy
    </footer>
  );
}
