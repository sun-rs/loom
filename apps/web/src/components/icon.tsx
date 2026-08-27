import raftIconsUrl from "@rah-os/ui-tokens/icons.svg?url";

export function Icon({ name }: { name: string }) {
  const mappedName =
    {
      chat: "message-square",
      chevron: "chevron-right",
      clip: "paperclip",
      doc: "code-xml",
      gear: "settings",
      kanban: "list-todo",
      listcheck: "list-todo",
      menu: "list-todo",
      members: "users",
      pulse: "activity",
      task: "square-check-big",
    }[name] ?? name;
  return (
    <svg aria-hidden="true">
      <use href={`${raftIconsUrl}#raft-icon-${mappedName}`} />
    </svg>
  );
}
