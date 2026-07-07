import { ChannelsView } from "@/components/channels/ChannelsView";
import { provisionAndGetActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

export default async function CanaisPage() {
  const actor = await provisionAndGetActor();
  const canPost = actor?.permissions.has("channel:post") ?? false;
  const canManageGroups = actor?.permissions.has("channel:manage") ?? false;
  return <ChannelsView canPost={canPost} canManageGroups={canManageGroups} myId={actor?.userId ?? ""} />;
}
