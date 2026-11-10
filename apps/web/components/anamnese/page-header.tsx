import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="font-headline text-xl font-bold text-primary">{title}</h2>
        {description && <p className="mt-1 text-sm text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-surface-lowest p-5 shadow-premium-soft">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-secondary">{label}</p>
        {icon && <span className="text-primary/60">{icon}</span>}
      </div>
      <p className="mt-2 font-headline text-3xl font-bold tabular-nums text-primary">{value}</p>
      {hint && <p className="mt-1 text-xs text-secondary">{hint}</p>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-surface-high p-8 text-center text-sm text-secondary">
      {children}
    </div>
  );
}
