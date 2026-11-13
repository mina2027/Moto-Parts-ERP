import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Save, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/misc';
import { PageHeader, Section } from '@/components/shared/page';
import { LoadingState } from '@/components/shared/states';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { branchService } from '@/services';
import { PERMISSION_CATEGORIES } from '@moto/shared';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Permission, RoleKey } from '@/types';

export default function RolesPage() {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const actor = useAuthStore((s) => s.session!.user);
  const roles = useQuery({ queryKey: ['roles'], queryFn: branchService.roles });
  const [draft, setDraft] = React.useState<Record<RoleKey, Set<Permission>> | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => { if (roles.data && !draft) setDraft(Object.fromEntries(roles.data.map((r) => [r.key, new Set(r.permissions)])) as Record<RoleKey, Set<Permission>>); }, [roles.data, draft]);
  if (roles.isLoading || !draft) return <LoadingState />;
  const list = roles.data ?? [];
  const dirty = list.some((r) => { const d = draft[r.key]; return d.size !== r.permissions.length || r.permissions.some((p) => !d.has(p)); });
  const toggle = (role: RoleKey, p: Permission) => { if (role === 'admin') return; setDraft((d) => { const n = { ...d! }; const s = new Set(n[role]); if (s.has(p)) s.delete(p); else s.add(p); n[role] = s; return n; }); };
  const toggleCategory = (role: RoleKey, perms: Permission[]) => { if (role === 'admin') return; setDraft((d) => { const n = { ...d! }; const s = new Set(n[role]); const all = perms.every((p) => s.has(p)); perms.forEach((p) => (all ? s.delete(p) : s.add(p))); n[role] = s; return n; }); };
  const save = async () => { for (const r of list) { if (r.key === 'admin') continue; await branchService.saveRolePermissions(r.key, Array.from(draft[r.key]), actor.id); } toast.success(t('users.roleSaved')); qc.invalidateQueries({ queryKey: ['roles'] }); setDraft(null); };

  return (
    <div>
      <PageHeader title={t('users.rolesTitle')} subtitle={t('users.permissionMatrix')} backTo="/users" actions={<Button disabled={!dirty} onClick={() => setConfirm(true)}><Save /> {t('common.save')}</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => <div key={r.key} className="flex items-start gap-3 rounded-lg border bg-card p-3"><div className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', r.key === 'admin' ? 'bg-purple-500/15 text-purple-600' : 'bg-primary/10 text-primary')}><ShieldCheck className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium">{tx(r.name)}</span>{r.isSystem ? <Badge variant="purple"><Lock className="size-3" /> {t('users.systemRole')}</Badge> : null}</div><div className="text-xs text-muted-foreground">{tx(r.description)}</div><div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Users className="size-3" /> {r.usersCount} {t('users.usersCount')}</span><span className="num">{draft[r.key].size} {t('users.permissions')}</span></div></div></div>)}
      </div>
      <Section title={t('users.permissionMatrix')}>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted"><tr><th className="sticky start-0 z-20 bg-muted px-3 py-2 text-start font-medium">{t('users.permissions')}</th>{list.map((r) => <th key={r.key} className="px-2 py-2 text-center font-medium whitespace-nowrap">{tx(r.name)}</th>)}</tr></thead>
            <tbody>
              {PERMISSION_CATEGORIES.map((c) => (
                <React.Fragment key={c.key}>
                  <tr className="bg-muted/40"><td className="sticky start-0 bg-muted/40 px-3 py-1.5 font-semibold">{t(`permissions.categories.${c.key}`)}</td>{list.map((r) => { const all = c.permissions.every((p) => draft[r.key].has(p)); const some = c.permissions.some((p) => draft[r.key].has(p)); return <td key={r.key} className="px-2 py-1.5 text-center"><Checkbox checked={all ? true : some ? 'indeterminate' : false} disabled={r.key === 'admin'} onCheckedChange={() => toggleCategory(r.key, c.permissions)} /></td>; })}</tr>
                  {c.permissions.map((p) => <tr key={p} className="border-t hover:bg-muted/30"><td className="sticky start-0 bg-card px-3 py-1.5 ps-6">{t(`permissions.keys.${p}`)}<span className="ms-2 font-mono text-[10px] text-muted-foreground">{p}</span></td>{list.map((r) => <td key={r.key} className="px-2 py-1.5 text-center"><Checkbox checked={draft[r.key].has(p)} disabled={r.key === 'admin'} onCheckedChange={() => toggle(r.key, p)} /></td>)}</tr>)}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t('users.editRole')} description={t('common.irreversible')} variant="warning" onConfirm={save} />
    </div>
  );
}
