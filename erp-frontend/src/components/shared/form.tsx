import * as React from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function FormField({ label, error, required, children, className, hint, htmlFor }: { label?: React.ReactNode; error?: string; required?: boolean; children: React.ReactNode; className?: string; hint?: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? <Label required={required} htmlFor={htmlFor}>{label}</Label> : null}
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FormGrid({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4' }[cols];
  return <div className={cn('grid gap-3', grid, className)}>{children}</div>;
}

interface BaseProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label?: React.ReactNode;
  required?: boolean;
  className?: string;
  hint?: React.ReactNode;
  disabled?: boolean;
}

export function TextField<T extends FieldValues>({ control, name, label, required, className, hint, disabled, type = 'text', placeholder, dir, step }: BaseProps<T> & { type?: string; placeholder?: string; dir?: 'ltr' | 'rtl'; step?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField label={label} required={required} error={fieldState.error?.message} className={className} hint={hint} htmlFor={name}>
          <Input id={name} type={type} placeholder={placeholder} dir={dir} step={step} disabled={disabled} {...field} value={field.value ?? ''} onChange={(e) => field.onChange(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} className={cn(fieldState.error && 'border-destructive')} />
        </FormField>
      )}
    />
  );
}

export function TextAreaField<T extends FieldValues>({ control, name, label, required, className, hint, disabled, placeholder, rows }: BaseProps<T> & { placeholder?: string; rows?: number }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField label={label} required={required} error={fieldState.error?.message} className={className} hint={hint} htmlFor={name}>
          <Textarea id={name} placeholder={placeholder} rows={rows} disabled={disabled} {...field} value={field.value ?? ''} />
        </FormField>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({ control, name, label, required, className, hint, disabled, options, placeholder }: BaseProps<T> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField label={label} required={required} error={fieldState.error?.message} className={className} hint={hint}>
          <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={disabled}>
            <SelectTrigger className={cn(fieldState.error && 'border-destructive')} id={name}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({ control, name, label, className, hint, disabled, description }: BaseProps<T> & { description?: React.ReactNode }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className={cn('flex items-center justify-between gap-3 rounded-md border px-3 py-2', className)}>
          <div className="min-w-0">
            <Label htmlFor={name} className="cursor-pointer">{label}</Label>
            {description || hint ? <p className="mt-0.5 text-xs text-muted-foreground">{description ?? hint}</p> : null}
          </div>
          <Switch id={name} checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
        </div>
      )}
    />
  );
}
