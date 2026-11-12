"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { CardPageData } from "@/lib/board/types";
import { CardContent } from "./CardContent";

/** Página `/card/[id]`: moldura em volta do `CardContent` (o mesmo do painel). */
export function CardPageView({
  data,
  myUserId = null,
}: {
  data: CardPageData;
  myUserId?: string | null;
}) {
  const router = useRouter();

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-4 flex items-center gap-2 text-sm text-neutral-500">
        <Link
          href={`/board?board=${data.boardId}`}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-neutral-100"
        >
          <ArrowLeft className="h-4 w-4" /> {data.boardName || "Quadro"}
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="font-medium text-neutral-500">#{data.number}</span>
        {data.stageName && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
            {data.stageName}
          </span>
        )}
      </div>

      <CardContent data={data} myUserId={myUserId} onChanged={() => router.refresh()} />
    </main>
  );
}
