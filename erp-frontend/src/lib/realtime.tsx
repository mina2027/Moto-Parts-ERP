import * as React from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { SOCKET_EVENTS } from '@moto/shared';
import { toast } from 'sonner';
import type { Alert } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) || undefined;

/** Connects Socket.IO once authenticated and maps server events to query invalidations. */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.session?.token ?? null);
  const { tx } = useT();
  const socketRef = React.useRef<Socket | null>(null);

  React.useEffect(() => {
    if (!token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }
    const socket = io(SOCKET_URL ?? window.location.origin, { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
    socketRef.current = socket;
    const inv = (...keys: string[][]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));

    // Events sent while disconnected are not replayed by Socket.IO.
    socket.on('connect', () => inv(['pos', 'catalog'], ['pos', 'catalogMeta'], ['products'], ['product'], ['categories']));

    socket.on(SOCKET_EVENTS.saleCreated, () => inv(['pos', 'session'], ['pos', 'catalog'], ['pos', 'recentSales'], ['pos', 'quick'], ['sales'], ['sale'], ['returns'], ['dashboard'], ['sessions'], ['session'], ['registers'], ['products'], ['product'], ['reports'], ['report'], ['accounting']));
    socket.on(SOCKET_EVENTS.stockChanged, () => inv(['pos', 'catalog'], ['pos', 'quick'], ['pos', 'alternatives'], ['products'], ['product'], ['inventory'], ['movements'], ['warehouse'], ['warehouses'], ['transfers'], ['transfer'], ['dashboard']));
    socket.on(SOCKET_EVENTS.productsChanged, () => inv(['pos'], ['products'], ['product'], ['categories'], ['inventory'], ['warehouse'], ['warehouses'], ['quick'], ['specialPrices'], ['customer'], ['dashboard'], ['reports'], ['audit']));
    socket.on(SOCKET_EVENTS.debtChanged, () => inv(['pos', 'customers'], ['debts'], ['customers'], ['customer'], ['dashboard']));
    socket.on(SOCKET_EVENTS.quickProductsChanged, () => inv(['pos', 'quick'], ['quick']));
    socket.on(SOCKET_EVENTS.settingsChanged, () => inv(['pos', 'settings'], ['pos', 'printProfiles'], ['settings'], ['printProfiles'], ['labelTemplates']));
    socket.on(SOCKET_EVENTS.notificationNew, (alert: Alert) => {
      inv(['alerts'], ['notifications']);
      if (alert.severity === 'critical') toast.warning(tx(alert.title), { description: tx(alert.body) });
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, qc, tx]);

  return <>{children}</>;
}
