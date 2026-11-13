import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function HomeRedirect() {
  const reports = useAuthStore((s) => s.hasPermission('reports.view'));
  const sales = useAuthStore((s) => s.hasPermission('sales.create'));
  const inventory = useAuthStore((s) => s.hasPermission('inventory.view'));
  const target = reports ? '/dashboard' : sales ? '/pos' : inventory ? '/inventory' : '/alerts';
  return <Navigate to={target} replace />;
}
