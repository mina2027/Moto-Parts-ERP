import * as React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, KeyRound, Pencil, Power, PowerOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { KeyValue, PageHeader, Section } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading, EmptyState } from '@/components/shared/states';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { UserFormDialog } from './UserFormDialog';
import { ChangePasswordDialog } from '@/components/layout/change-password-dialog';
import { branchService, reportService } from '@/services';
import { PERMISSION_CATEGORIES, resolvePermissions } from '@moto/shared';
import type { Permission, RoleKey, User } from '@/types';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDateTime } from '@/lib/utils';

export default function UserDetailsPage() {
  const { id = '' } = useParams();
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const actor = useAuthStore((s) => s.session!.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { branchName } = useLookups();
  const [editOpen, setEditOpen] = React.useState(false);
  const [toggleOpen, setToggleOpen] = React.useState(false);
  const [pwdOpen, setPwdOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const q = useQuery({ queryKey: ['user', id], queryFn: () => branchService.getUser(id) });
  const audit = useQuery({ queryKey: ['audit', { userId: id }], queryFn: () => reportService.auditLogs({ userId: id, pageSize: 40 }) });
  // Effective permissions must reflect DB-edited roles, not the static defaults.
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: branchService.roles, enabled: hasPermission('users.view') });
  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const u = q.data;
  const overrides = Object.fromEntries((rolesQ.data ?? []).map((r) => [r.key, r.permissions])) as Partial<Record<RoleKey, Permission[]>>;
  const perms = new Set(resolvePermissions(u.role, u.extraPermissions ?? [], overrides));
  const canEdit = hasPermission('users.edit');
  const isSelf = actor.id === u.id;
  const fullUser = (patch: Partial<User>) => ({ id: u.id, username: u.username, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, branchId: u.branchId, status: u.status, extraPermissions: u.extraPermissions, ...patch });

  return (
    <div>
      <PageHeader backTo="/users" title={<span className="flex items-center gap-3"><Avatar name={tx(u.fullName)} color={u.avatarColor} size="lg" />{tx(u.fullName)}</span>} badge={<><StatusBadge status={u.role === 'admin' ? 'purple' : 'open'} label={t(`roles.${u.role}`)} /><StatusBadge status={u.status} labelKey="users.status" /></>} subtitle={<span dir="ltr">@{u.username} · {u.email}</span>}
        actions={<>{isSelf ? <Button variant="outline" onClick={() => setPwdOpen(true)}><KeyRound /> {t('common.changePassword')}</Button> : null}{canEdit && !isSelf ? <><Button variant="outline" onClick={() => setResetOpen(true)}><KeyRound /> {t('users.resetPassword')}</Button><Button variant={u.status === 'active' ? 'destructive' : 'success'} onClick={() => setToggleOpen(true)}>{u.status === 'active' ? <><PowerOff /> {t('users.deactivate')}</> : <><Power /> {t('users.activate')}</>}</Button></> : null}{canEdit ? <Button onClick={() => setEditOpen(true)}><Pencil /> {t('common.edit')}</Button> : null}</>} />
      <Tabs defaultValue="info">
        <TabsList variant="underline"><TabsTrigger variant="underline" value="info">{t('common.generalInfo')}</TabsTrigger><TabsTrigger variant="underline" value="perms">{t('users.permissions')} <Badge variant="secondary" className="ms-1">{perms.size}</Badge></TabsTrigger><TabsTrigger variant="underline" value="audit">{t('users.auditHistory')}</TabsTrigger></TabsList>
        <TabsContent value="info"><Section title={t('users.userDetails')}><KeyValue cols={3} items={[{ label: t('common.username'), value: <span dir="ltr">{u.username}</span> }, { label: t('common.nameAr'), value: u.fullName.ar }, { label: t('common.nameEn'), value: u.fullName.en }, { label: t('common.email'), value: <span dir="ltr">{u.email}</span> }, { label: t('common.phone'), value: <span className="num">{u.phone}</span> }, { label: t('common.branch'), value: branchName(u.branchId) }, { label: t('users.role'), value: t(`roles.${u.role}`) }, { label: t('common.lastLogin'), value: u.lastLogin ? formatDateTime(u.lastLogin, locale) : t('common.never') }, { label: t('common.createdAt'), value: formatDateTime(u.createdAt, locale) }]} /></Section></TabsContent>
        <TabsContent value="perms">
          <Section title={t('users.effectivePermissions')} description={`${t('users.fromRole')}: ${t(`roles.${u.role}`)}`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PERMISSION_CATEGORIES.map((c) => <div key={c.key} className="rounded-md border p-3"><div className="mb-2 text-xs font-semibold">{t(`permissions.categories.${c.key}`)}</div><ul className="space-y-1">{c.permissions.map((p) => { const on = perms.has(p); return <li key={p} className={cn('flex items-center gap-1.5 text-xs', on ? '' : 'text-muted-foreground line-through opacity-60')}>{on ? <Check className="size-3.5 text-success" /> : <X className="size-3.5" />}{t(`permissions.keys.${p}`)}</li>; })}</ul></div>)}
            </div>
          </Section>
        </TabsContent>
        <TabsContent value="audit">
          <Section title={t('users.loginActivity')}>
            {audit.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.action')}</th><th className="pb-2 text-start font-medium">{t('common.entity')}</th><th className="pb-2 text-start font-medium">{t('common.branch')}</th><th className="pb-2 text-start font-medium">{t('audit.ip')}</th><th className="pb-2 text-start font-medium">{t('audit.changes')}</th></tr></thead><tbody>{audit.data.data.map((l) => <tr key={l.id} className="border-t"><td className="py-1.5 num text-xs">{formatDateTime(l.date, locale)}</td><td className="py-1.5"><StatusBadge status={l.action === 'login' ? 'paid' : l.action === 'logout' ? 'closed' : 'open'} label={t(`audit.actions.${l.action}`)} /></td><td className="py-1.5 text-xs">{l.entity} <span className="num text-muted-foreground">{l.entityId}</span></td><td className="py-1.5 text-xs">{branchName(l.branchId)}</td><td className="py-1.5 num text-xs text-muted-foreground">{l.ip}</td><td className="py-1.5 font-mono text-[10px] text-muted-foreground">{l.after ? JSON.stringify(l.after).slice(0, 60) : '—'}</td></tr>)}</tbody></table> : <EmptyState />}
          </Section>
        </TabsContent>
      </Tabs>
      <UserFormDialog open={editOpen} onOpenChange={setEditOpen} user={u} onSaved={() => q.refetch()} />
      <ConfirmDialog open={toggleOpen} onOpenChange={setToggleOpen} title={u.status === 'active' ? t('users.deactivateConfirm') : t('users.activate')} description={u.status === 'active' ? t('users.deactivateDesc') : undefined} variant={u.status === 'active' ? 'destructive' : 'success'} onConfirm={async () => { await branchService.saveUser(fullUser({ status: u.status === 'active' ? 'inactive' : 'active' }), actor.id); toast.success(u.status === 'active' ? t('users.userDeactivated') : t('users.userActivated')); q.refetch(); qc.invalidateQueries({ queryKey: ['users'] }); }} />
      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
      <ResetPasswordDialog open={resetOpen} onOpenChange={setResetOpen} onSubmit={async (password) => { await branchService.saveUser({ ...fullUser({}), password }, actor.id); toast.success(t('auth.passwordChanged')); }} />
    </div>
  );
}
