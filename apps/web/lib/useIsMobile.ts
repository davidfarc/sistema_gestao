"use client";

import { useEffect, useState } from "react";

/**
 * A tela é de celular (abaixo de 768 px, o `md` do Tailwind)? Devolve `null`
 * até montar no navegador, porque o servidor não sabe o tamanho da tela.
 */
export function useIsMobile(): boolean | null {
  const [mobile, setMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}
