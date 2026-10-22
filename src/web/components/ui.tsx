import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { X } from 'lucide-react';

export function cn(...args: Parameters<typeof clsx>): string {
  return clsx(...args);
}

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 border border-slate-900 active:bg-slate-950',
  outline:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100',
  ghost: 'bg-transparent text-slate-600 border border-transparent hover:bg-slate-100 active:bg-slate-200',
  danger: 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 active:bg-rose-100',
  subtle: 'bg-slate-100 text-slate-700 border border-transparent hover:bg-slate-200 active:bg-slate-300',
};

const SIZES = {
  xs: 'h-6 px-2 text-[11px] gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-xs gap-1 rounded-md',
  md: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
};

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-all',
        'active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 outline-none',
        'focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 w-full appearance-none rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-800 outline-none',
        'focus:border-slate-500 focus:ring-2 focus:ring-slate-200',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-[11px] text-slate-600 disabled:opacity-50"
    >
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-3 rounded-full bg-white transition-all',
            checked ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue';
  className?: string;
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    blue: 'bg-blue-50 text-blue-700',
  } as const;
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/30 p-6" onMouseDown={onClose}>
      <div
        className={cn('mt-12 w-full rounded-xl border border-slate-200 bg-white shadow-xl', width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-slate-800">{title}</h2>
            {description ? <p className="mt-0.5 text-[11px] text-slate-500">{description}</p> : null}
          </div>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
