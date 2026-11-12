"use client";

import { useEffect, useState } from "react";

import type { NotificationView } from "@/lib/board/types";
import { loadNotifications, markAllNotificationsRead } from "@/lib/notifications/actions";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/** Avisos recentes (menções e atribuições). Abrir a tela marca todos como lidos. */
export function NotificationsList() {
  const [items, setItems] = useState<NotificationView[] | null>(null);

  useEffect(() => {
    let active = true;
    loadNotifications().then((list) => {
      if (!active) return;
      setItems(list);
      if (list.some((n) => !n.read)) markAllNotificationsRead();
    });
    return () => {
      active = false;
    };
  }, []);

  if (items === null) {
    return (
      <div className="grid gap-2" aria-hidden="true">
        <div className="h-16 animate-pulse rounded-xl bg-neutral-100" />
        <div className="h-16 animate-pulse rounded-xl bg-neutral-100" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-600">
        Nenhum aviso por enquanto. Quando alguém mencionar você ou lhe atribuir um card, aparece
        aqui.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      {items.map((n) => (
        <li key={n.id} className={n.read ? "" : "bg-primary/5"}>
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              className={
                "mt-2 h-2 w-2 shrink-0 rounded-full " + (n.read ? "bg-transparent" : "bg-primary")
              }
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-800">
                {!n.read && <span className="sr-only">Novo: </span>}
                {n.title}
              </p>
              {n.subtitle && <p className="truncate text-sm text-neutral-600">{n.subtitle}</p>}
              <p className="mt-0.5 text-xs text-neutral-500">{timeAgo(n.createdAt)}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
