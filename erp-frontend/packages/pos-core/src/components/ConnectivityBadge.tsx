import * as React from 'react';
import { Badge, Button, cn } from '@moto/ui';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import type { ConnectivityState, PosAdapter } from '../adapter';
import { formatDateTime, usePosT } from '../i18n';

export function useConnectivity(adapter: PosAdapter): ConnectivityState {
  const [s, setS] = React.useState(adapter.connectivity());
  React.useEffect(() => adapter.subscribeConnectivity(setS), [adapter]);
  return s;
}

export function ConnectivityBadge({ adapter, compact }: { adapter: PosAdapter; compact?: boolean }) {
  const { p } = usePosT();
  const s = useConnectivity(adapter);
  const label = s.syncing ? p.syncing : s.online ? p.online : p.offline;
  const variant = s.error || s.rejected > 0 ? 'destructive' : s.syncing ? 'warning' : s.online ? 'success' : 'secondary';
  return (
    <div className={cn('flex items-center gap-2', compact ? 'text-[11px]' : 'text-xs')}>
      <Badge variant={variant} className="gap-1">
        {s.online ? <Cloud className="size-3" /> : <CloudOff className="size-3" />}
        {label}
        {s.pending > 0 ? <span className="num">· {s.pending} {p.pendingOps}</span> : null}
        {s.rejected > 0 ? <span className="num">· {s.rejected} {p.rejectedOps}</span> : null}
      </Badge>
      {!compact && s.lastSyncAt ? <span className="text-muted-foreground">{p.lastSync}: {formatDateTime(s.lastSyncAt)}</span> : null}
      {adapter.syncNow ? (
        <Button size="icon-xs" variant="ghost" onClick={() => void adapter.syncNow?.()} aria-label={p.syncNow} disabled={!s.online || s.syncing}>
          <RefreshCw className={cn('size-3.5', s.syncing && 'animate-spin')} />
        </Button>
      ) : null}
    </div>
  );
}
