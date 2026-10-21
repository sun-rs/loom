// Loom directory projection and picker state; original JSX lives in the generated source view.
import { useState, type RefObject } from "react";
import type { ComboboxProps } from "raft-ui";
import { OfficialSearchIdentityFilter } from "./OfficialSearchControls.generated";
import type { Principal, Room } from "@rah-os/protocol";
export function useSearchIdentityController({
  kind,
  disabled,
  principals,
  rooms,
  selfId,
  params,
  update,
  openFilterMenu,
  setOpenFilterMenu,
  filtersPortalRef,
}: {
  kind: "from" | "channel";
  disabled: boolean;
  principals: Principal[];
  rooms: Room[];
  selfId?: string;
  params: URLSearchParams;
  update: (key: string, value: string) => void;
  openFilterMenu: string | null;
  setOpenFilterMenu: (value: string | null) => void;
  filtersPortalRef: RefObject<HTMLDivElement | null>;
}) {
  const filtersPortalProps = { container: filtersPortalRef };
  const [senderFilterQuery, setSenderFilterQuery] = useState("");
  const [channelFilterQuery, setChannelFilterQuery] = useState("");
  const senderIdParam = params.get("senderId"),
    channelIdParam = params.get("channelId");
  const senderOptions = principals
    .map((p) => ({
      id: p.principalId,
      label: p.displayName ?? p.handle,
      handle: p.handle,
      type: p.kind === "agent" ? "agent" : "user",
      isSelf: p.principalId === selfId,
      avatarUrl: null,
      gravatarHash: null,
      email: null,
    }))
    .sort(
      (a, b) =>
        Number(b.isSelf) - Number(a.isSelf) ||
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
    );
  const filteredSenderOptions = senderOptions.filter((p) =>
    `${p.label} ${p.handle}`
      .toLowerCase()
      .includes(senderFilterQuery.trim().toLowerCase()),
  );
  const senderItemIds = filteredSenderOptions.map((p) => p.id);
  const senderItemLabel = (id: string) =>
    senderOptions.find((p) => p.id === id)?.label ?? id;
  const selectedSender = senderOptions.find((p) => p.id === senderIdParam);
  const handleFromMenuOpenChange = (open: boolean) =>
    setOpenFilterMenu(open ? "from" : null);
  const handleSenderInputChange: NonNullable<
    ComboboxProps<string>["onInputValueChange"]
  > = (value, details) => {
    if (details.reason !== "item-press") setSenderFilterQuery(value);
  };
  const handleSenderChange = (value: string | null) =>
    update("senderId", value ?? "");
  const clearSenderFilter = () => update("senderId", "");
  const channels = rooms
    .filter((r) => r.kind === "channel")
    .map((r) => ({ id: r.roomId, name: r.name }));
  const dmChannels = rooms
    .filter((r) => r.kind === "direct")
    .map((r) => ({ id: r.roomId, name: r.name }));
  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(channelFilterQuery.trim().toLowerCase()),
  );
  const channelItemIds = filteredChannels.map((c) => c.id);
  const channelItemLabel = (id: string) =>
    channels.find((c) => c.id === id)?.name ?? id;
  const handleChannelMenuOpenChange = (open: boolean) =>
    setOpenFilterMenu(open ? "channel" : null);
  const handleChannelInputChange: NonNullable<
    ComboboxProps<string>["onInputValueChange"]
  > = (value, details) => {
    if (details.reason !== "item-press") setChannelFilterQuery(value);
  };
  const handleChannelChange = (value: string | null) => {
    if (value) update("channelId", value);
  };
  const clearChannelFilter = () => update("channelId", "");
  return {
    kind,
    disabled,
    filtersPortalProps,
    openFilterMenu,
    senderFilterQuery,
    senderItemIds,
    senderItemLabel,
    senderIdParam,
    handleFromMenuOpenChange,
    handleSenderInputChange,
    handleSenderChange,
    clearSenderFilter,
    selectedSender,
    filteredSenderOptions,
    channelIdParam,
    channels,
    dmChannels,
    clearChannelFilter,
    channelFilterQuery,
    channelItemIds,
    channelItemLabel,
    handleChannelMenuOpenChange,
    handleChannelInputChange,
    handleChannelChange,
    filteredChannels,
  };
}
export default function SearchIdentityFilter(
  props: Parameters<typeof useSearchIdentityController>[0],
) {
  return (
    <OfficialSearchIdentityFilter {...useSearchIdentityController(props)} />
  );
}
