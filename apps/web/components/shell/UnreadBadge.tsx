"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

import { loadUnreadTotal } from "@/lib/comms/actions";
import { createClient } from "@/lib/supabase/client";

/**
 * Badge de não-lidas no item "Conversas" da sidebar. Busca o total no servidor
 * e reage ao Realtime: mensagem nova (message INSERT) ou marcação de lida
 * (channel_member UPDATE de last_read_at) disparam um refetch. `collapsed`
 * mostra só um ponto quando a sidebar está recolhida.
 */
export function UnreadBadge({ collapsed }: { collapsed: boolean }) {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      loadUnreadTotal().then((n) => {
        if (!cancelled) setTotal(n);
      });
    };
    refetch();

    const supabase = createClient();
    const channel = supabase
      .channel("sidebar-unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message" }, refetch)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "channel_member" },
        refetch,
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  if (total <= 0) return null;

  if (collapsed) {
    return (
      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-tertiary-fixed" aria-hidden />
    );
  }
  return (
    <span
      className={clsx(
        "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
        "bg-tertiary-fixed text-[10px] font-bold text-primary",
      )}
      aria-label={`${total} não lidas`}
    >
      {total > 99 ? "99+" : total}
    </span>
  );
}
