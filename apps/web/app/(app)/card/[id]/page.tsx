import { notFound } from "next/navigation";

import { CardPageView } from "@/components/board/CardPageView";
import { loadCardPage } from "@/lib/board/actions";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadCardPage(id);
  if (!data) notFound();
  return <CardPageView data={data} />;
}
