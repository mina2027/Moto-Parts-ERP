import * as React from 'react';
import { Button } from '@/components/ui/button';
import { DateRangeInputs, FilterSelect } from './page';
import { presetRange, type DatePreset } from '@/services/reportService';
import { useT } from '@/i18n';
import { useLookups } from '@/hooks/useLookups';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

export interface RangeState {
  preset: DatePreset;
  from: string;
  to: string;
  branchId?: string;
}

export function useRangeState(initialPreset: DatePreset = 'month', scopeBranch = true): [RangeState, (patch: Partial<RangeState>) => void] {
  const currentBranchId = useAuthStore((s) => s.session!.user.branchId);
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const [state, setState] = React.useState<RangeState>(() => ({ preset: initialPreset, ...presetRange(initialPreset), branchId: scopeBranch ? (canAll ? undefined : currentBranchId) : undefined }));
  const set = React.useCallback((patch: Partial<RangeState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      if (patch.preset && patch.preset !== 'custom') Object.assign(next, presetRange(patch.preset));
      return next;
    });
  }, []);
  return [state, set];
}

export function DatePresetBar({ value, onChange, showBranch = true, className }: { value: RangeState; onChange: (p: Partial<RangeState>) => void; showBranch?: boolean; className?: string }) {
  const { t } = useT();
  const { options } = useLookups();
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const presets: { key: DatePreset; label: string }[] = [
    { key: 'today', label: t('common.today') },
    { key: 'yesterday', label: t('common.yesterday') },
    { key: 'week', label: t('common.thisWeek') },
    { key: 'month', label: t('common.thisMonth') },
    { key: 'custom', label: t('common.custom') },
  ];
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="inline-flex rounded-md border bg-card p-0.5">
        {presets.map((p) => (
          <Button key={p.key} size="xs" variant={value.preset === p.key ? 'default' : 'ghost'} onClick={() => onChange({ preset: p.key })} className="h-7">
            {p.label}
          </Button>
        ))}
      </div>
      {value.preset === 'custom' ? <DateRangeInputs from={value.from} to={value.to} onChange={(from, to) => onChange({ from: from ?? value.from, to: to ?? value.to })} /> : null}
      {showBranch && canAll ? <FilterSelect value={value.branchId} onChange={(v) => onChange({ branchId: v === 'all' ? undefined : v })} options={options.activeBranches} allLabel={t('common.allBranches')} width="w-48" /> : null}
    </div>
  );
}
