import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import clsx from "clsx";

// Cartões, selos, avisos e tabelas no padrão visual do sistema.

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("rounded-2xl border border-black/5 bg-surface-lowest shadow-premium-soft", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("flex flex-col gap-1 p-5 pb-3", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={clsx("font-headline text-base font-bold text-primary", className)} {...p} />
);
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={clsx("text-sm text-secondary", className)} {...p} />
);
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={clsx("p-5 pt-2", className)} {...p} />
);

const BADGE = {
  default: "bg-primary/5 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  muted: "bg-surface-low text-secondary",
} as const;

export function Badge({
  className,
  variant = "default",
  ...p
}: HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof BADGE | null }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center whitespace-nowrap rounded-xl px-2.5 py-1 text-xs font-bold",
        BADGE[variant ?? "default"],
        className,
      )}
      {...p}
    />
  );
}

const ALERT = {
  info: "border-primary/10 bg-primary/5 text-primary",
  success: "border-success/20 bg-success/5 text-success",
  error: "border-danger/20 bg-danger/5 text-danger",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
} as const;

export function Alert({
  variant = "info",
  className,
  ...p
}: HTMLAttributes<HTMLDivElement> & { variant?: keyof typeof ALERT }) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={clsx("rounded-lg border px-3 py-2 text-sm", ALERT[variant], className)}
      {...p}
    />
  );
}

export const Table = ({ className, ...p }: TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto">
    <table className={clsx("w-full text-sm", className)} {...p} />
  </div>
);
export const Th = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={clsx("whitespace-nowrap bg-surface-low px-4 py-3 text-left font-semibold text-primary", className)}
    {...p}
  />
);
export const Td = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={clsx("border-t border-surface-medium px-4 py-2.5 align-middle", className)} {...p} />
);
