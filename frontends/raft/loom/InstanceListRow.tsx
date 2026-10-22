import type { ReactNode } from "react";
import { ListRow, ListRowBody, ListRowTitle, ListRowMeta } from "raft-ui";
/** Grouped variant of official AvatarListRow. Its actionContent branch uses a
 * standalone SurfaceListItem card; grouped rows instead keep RUI ListRow as
 * the direct child so the native inset hairline and group border have one owner.
 * The body button and overflow remain siblings, never nested buttons. */
export default function InstanceListRow({
  avatar,
  name,
  subtitle,
  status,
  actions,
  onClick,
}: {
  avatar: ReactNode;
  name: string;
  subtitle: string;
  status: ReactNode;
  actions: ReactNode;
  onClick?: () => void;
}) {
  return (
    <ListRow render={<div />}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        aria-label={`查看实例 ${name}`}
        className="flex min-w-0 flex-1 self-stretch items-center gap-3 text-left outline-none focus-visible:shadow-focus"
      >
        {avatar}
        <ListRowBody>
          <ListRowTitle>{name}</ListRowTitle>
          <ListRowMeta>{subtitle}</ListRowMeta>
        </ListRowBody>
      </button>
      {status}
      <span className="flex shrink-0 items-center">{actions}</span>
    </ListRow>
  );
}
