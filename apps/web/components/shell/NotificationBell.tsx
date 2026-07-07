"use client";

import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { NotificationView } from "@/lib/board/types";
import {
  loadNotifications,
  markAllNotificationsRead,
  notificationUnreadCount,
} from "@/lib/notifications/actions";
import { createClient } from "@/lib/supabase/client";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    notificationUnreadCount().then(setUnread);
  }, []);

  useEffect(() => {
    refreshCount();
    const supabase = createClient();
    const channel = supabase
      .channel("notification-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notification" },
        refreshCount,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshCount]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setItems(await loadNotifications());
      if (unread > 0) {
        await markAllNotificationsRead();
        setUnread(0);
      }
    }
  }

  return (
    <div ref={rootRef} className="fixed right-3 top-3 z-[90]">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notificações"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
          <div className="border-b border-neutral-100 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-neutral-800">Notificações</h3>
          </div>
          <ul className="max-h-96 divide-y divide-neutral-100 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={n.read ? "" : "bg-primary/5"}>
                <div className="flex items-start gap-2.5 px-4 py-3">
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  <div className={n.read ? "min-w-0 pl-4" : "min-w-0"}>
                    <p className="text-sm text-neutral-800">{n.title}</p>
                    {n.subtitle && <p className="truncate text-xs text-neutral-500">{n.subtitle}</p>}
                    <p className="mt-0.5 text-[10px] text-neutral-400">{timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              </li>
            ))}
            {items.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-neutral-400">
                Nenhuma notificação.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
