"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";

/**
 * Peças das células da Lista que QUEBRAM LINHA em vez de esconder o texto.
 * A linha da tabela cresce para mostrar o conteúdo inteiro.
 */

const base =
  "block w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-neutral-200 focus:border-neutral-400";

/** Texto editável que cresce com o conteúdo (várias linhas, sem barra de rolagem). */
export function WrapText({
  className = "",
  onKeyDown,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  // Reajusta ao montar e quando a coluna muda de largura.
  useEffect(() => {
    fit();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      onInput={fit}
      onKeyDown={(e) => {
        // Enter confirma (sai do campo); Shift+Enter quebra a linha.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
        onKeyDown?.(e);
      }}
      className={`${base} resize-none overflow-hidden leading-snug ${className}`}
      {...props}
    />
  );
}

/**
 * Seletor que mostra a opção escolhida com quebra de linha. O texto visível é
 * um rótulo comum; por cima dele fica o <select> nativo transparente, que
 * continua cuidando de clique, toque e teclado.
 */
export function WrapSelect({
  value,
  label,
  onChange,
  children,
  ariaLabel,
  className = "",
  disabled,
}: {
  value: string;
  /** Texto mostrado (o nome da opção escolhida). */
  label: string;
  onChange: (value: string) => void;
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`relative flex min-w-0 items-start gap-1 rounded border border-transparent px-1 py-0.5 text-sm hover:border-neutral-200 focus-within:border-neutral-400 ${className}`}
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">{label}</span>
      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      >
        {children}
      </select>
    </div>
  );
}
