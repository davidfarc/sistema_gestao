import { notFound } from "next/navigation";

import { CardPageView } from "@/components/board/CardPageView";
import { provisionAndGetActor } from "@/lib/actor";
import { loadCardPage } from "@/lib/board/actions";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, actor] = await Promise.all([loadCardPage(id), provisionAndGetActor()]);
  if (!data) notFound();
  return <CardPageView data={data} myUserId={(actor?.userId as string) ?? null} />;
}
