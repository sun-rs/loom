// Structural port of MessageSearchPage's From/Channel JSX; frozen upstream revision in adoption.json.
import { useState, type RefObject } from "react";
import { useIntl } from "react-intl";
import { UserCircle2, ChevronDown, Hash, X } from "lucide-react";
import {
  Button,
  PickerTriggerButton,
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxHeader,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxTriggerIndicator,
  type ComboboxProps,
} from "raft-ui";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import type { Principal, Room } from "@rah-os/protocol";
export default function SearchIdentityFilter({
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
  activeFilterClass,
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
  activeFilterClass: string;
}) {
  const { formatMessage } = useIntl();
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
  if (kind === "from")
    return (
      <Combobox<string>
        disabled={disabled}
        autoHighlight
        open={openFilterMenu === "from"}
        onOpenChange={handleFromMenuOpenChange}
        inputValue={senderFilterQuery}
        items={senderItemIds}
        itemToStringLabel={senderItemLabel}
        value={senderIdParam ?? null}
        onInputValueChange={handleSenderInputChange}
        onValueChange={handleSenderChange}
      >
        <ComboboxTrigger
          aria-label={formatMessage({ id: "search.from" })}
          render={
            <PickerTriggerButton
              className={senderIdParam ? activeFilterClass : undefined}
            />
          }
        >
          <UserCircle2 aria-hidden size={14} />
          <span>
            {selectedSender
              ? formatMessage(
                  { id: "search.fromWithName" },
                  {
                    name: selectedSender.isSelf
                      ? formatMessage({ id: "search.fromMe" })
                      : selectedSender.label,
                  },
                )
              : formatMessage({ id: "search.from" })}
          </span>
          <ComboboxTriggerIndicator>
            <ChevronDown aria-hidden size={12} />
          </ComboboxTriggerIndicator>
        </ComboboxTrigger>
        <ComboboxContent
          align="start"
          finalFocus={false}
          initialFocus={false}
          portalProps={filtersPortalProps}
        >
          <ComboboxHeader>
            <ComboboxLabel>
              {formatMessage({ id: "search.from" })}
            </ComboboxLabel>
            {senderIdParam && (
              <ComboboxClear onClick={clearSenderFilter}>
                {formatMessage({ id: "ui.selectionPopover.clear" })}
              </ComboboxClear>
            )}
          </ComboboxHeader>
          <ComboboxSeparator />
          <ComboboxInputGroup>
            <ComboboxInput
              aria-label={formatMessage({ id: "search.from" })}
              placeholder={formatMessage({
                id: "ui.selectionPopover.searchPlaceholder",
              })}
              suppressPasswordManager
            />
          </ComboboxInputGroup>
          <ComboboxList>
            {filteredSenderOptions.map((sender) => (
              <ComboboxItem key={sender.id} value={sender.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <AvatarSlot
                      context="compact-list"
                      type={sender.type === "agent" ? "agent" : "human"}
                      agentAvatarUrl={
                        sender.type === "agent"
                          ? (sender.avatarUrl ?? null)
                          : null
                      }
                      humanAvatarUrl={
                        sender.type === "user"
                          ? (sender.avatarUrl ?? null)
                          : null
                      }
                      gravatarHash={
                        sender.type === "user"
                          ? (sender.gravatarHash ?? null)
                          : null
                      }
                      email={
                        sender.type === "user" ? (sender.email ?? null) : null
                      }
                    />
                  </span>
                  <span className="truncate">
                    {sender.isSelf
                      ? formatMessage({ id: "search.fromMe" })
                      : sender.label}
                  </span>
                </span>
                <ComboboxItemIndicator />
              </ComboboxItem>
            ))}
          </ComboboxList>
          <ComboboxEmpty>
            {formatMessage({ id: "ui.selectionPopover.emptyLabel" })}
          </ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
    );
  return channelIdParam ? (
    (() => {
      const ch =
        channels.find((c) => c.id === channelIdParam) ??
        dmChannels.find((c) => c.id === channelIdParam);
      const label = ch
        ? `#${ch.name}`
        : `#${formatMessage({ id: "search.channel" })}`;
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clearChannelFilter}
          className={activeFilterClass}
        >
          <Hash size={12} />
          {label}
          <X size={10} />
        </Button>
      );
    })()
  ) : (
    <Combobox<string>
      disabled={disabled}
      autoHighlight
      open={openFilterMenu === "channel"}
      onOpenChange={handleChannelMenuOpenChange}
      inputValue={channelFilterQuery}
      items={channelItemIds}
      itemToStringLabel={channelItemLabel}
      value={null}
      onInputValueChange={handleChannelInputChange}
      onValueChange={handleChannelChange}
    >
      <ComboboxTrigger
        aria-label={formatMessage({ id: "search.openChannelFilter" })}
        render={<PickerTriggerButton />}
      >
        <Hash aria-hidden size={14} />
        <span>{formatMessage({ id: "search.channel" })}</span>
        <ComboboxTriggerIndicator>
          <ChevronDown aria-hidden size={12} />
        </ComboboxTriggerIndicator>
      </ComboboxTrigger>
      <ComboboxContent
        align="start"
        finalFocus={false}
        initialFocus={false}
        portalProps={filtersPortalProps}
      >
        <ComboboxHeader>
          <ComboboxLabel>
            {formatMessage({ id: "search.channels" })}
          </ComboboxLabel>
        </ComboboxHeader>
        <ComboboxSeparator />
        <ComboboxInputGroup>
          <ComboboxInput
            aria-label={formatMessage({ id: "search.channels" })}
            placeholder={formatMessage({
              id: "ui.selectionPopover.searchPlaceholder",
            })}
            suppressPasswordManager
          />
        </ComboboxInputGroup>
        <ComboboxList>
          {filteredChannels.map((ch) => (
            <ComboboxItem key={ch.id} value={ch.id}>
              <span className="flex size-5 shrink-0 items-center justify-center">
                <Hash aria-hidden size={12} />
              </span>
              <span>#{ch.name}</span>
              <ComboboxItemIndicator />
            </ComboboxItem>
          ))}
        </ComboboxList>
        <ComboboxEmpty>
          {formatMessage({ id: "ui.selectionPopover.emptyLabel" })}
        </ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
