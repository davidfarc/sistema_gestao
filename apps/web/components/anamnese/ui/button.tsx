import { Children, cloneElement, forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactElement } from "react";
import clsx from "clsx";

// Botões no padrão visual do sistema (mesmas classes de Gestão de Vila/Quadro).

const VARIANT = {
  default: "bg-primary text-white hover:bg-primary-high",
  accent: "bg-success text-white hover:opacity-90",
  destructive: "bg-danger text-white hover:opacity-90",
  outline: "border border-black/5 bg-surface-lowest text-secondary hover:text-primary",
  secondary: "bg-surface-low text-primary hover:bg-surface-medium",
  ghost: "text-secondary hover:text-primary hover:bg-surface-low",
  link: "text-primary underline-offset-4 hover:underline",
} as const;

const SIZE = {
  default: "px-3.5 py-2 text-sm",
  sm: "px-2.5 py-1.5 text-xs",
  lg: "px-5 py-3 text-base",
  icon: "h-9 w-9",
} as const;

export type ButtonVariant = keyof typeof VARIANT;
export type ButtonSize = keyof typeof SIZE;

export function buttonClass(variant: ButtonVariant = "default", size: ButtonSize = "default", className?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-bold transition-colors",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Aplica o estilo ao único filho (ex.: <Link>) em vez de renderizar um <button>. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, children, ...props }, ref) => {
    const cls = buttonClass(variant, size, className);
    if (asChild) {
      const child = Children.only(children);
      if (isValidElement<{ className?: string }>(child)) {
        return cloneElement(child as ReactElement<{ className?: string }>, {
          className: clsx(cls, child.props.className),
        });
      }
    }
    return (
      <button ref={ref} className={cls} {...props}>
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
