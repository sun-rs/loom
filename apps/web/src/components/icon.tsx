import raftIconsUrl from "@rah-os/ui-tokens/icons.svg?url";
import discoveryIconsUrl from "@rah-os/ui-tokens/discovery-icons.svg?url";
import interactionIconsUrl from "@rah-os/ui-tokens/interaction-icons.svg?url";

export function Icon({
  className,
  name,
}: {
  className?: string;
  name: string;
}) {
  const mappedName =
    {
      "arrow-left": "chevron-right",
      briefcase: "code-xml",
      chat: "message-square",
      chevron: "chevron-right",
      clip: "paperclip",
      doc: "code-xml",
      folder: "paperclip",
      gear: "settings",
      listcheck: "list-todo",
      link: "code-xml",
      menu: "list-todo",
      members: "users",
      pulse: "activity",
      "share-2": "users",
      task: "square-check-big",
    }[name] ?? name;
  return (
    <svg aria-hidden="true" className={className}>
      <use
        href={`${["calendar-range", "bot", "folder-open", "link-2", "blocks", "grip-vertical", "circle-user-round", "eye-off", "x"].includes(mappedName) ? interactionIconsUrl : ["at-sign", "refresh-cw"].includes(mappedName) ? discoveryIconsUrl : raftIconsUrl}#raft-icon-${mappedName}`}
      />
    </svg>
  );
}
