// v1.21.26 SJ AvatarListRow composition. @botiverse/raft-ui owns every recipe.
// Only Computer instance content and its Role navigation are Loom-owned.
import type { ReactNode } from "react";
import {
  ListRow,
  ListRowGroup,
  ListRowBody,
  ListRowTitle,
  ListRowDescription,
} from "raft-ui";
export { ListRowGroup as OfficialListRowGroup };
export function OfficialAvatarListRow({
  avatar,
  name,
  subtitle,
  onClick,
}: {
  avatar: ReactNode;
  name: ReactNode;
  subtitle?: ReactNode;
  onClick: () => void;
}) {
  return (
    <ListRow onClick={onClick}>
      {avatar}
      <ListRowBody>
        <ListRowTitle>{name}</ListRowTitle>
        {subtitle && <ListRowDescription>{subtitle}</ListRowDescription>}
      </ListRowBody>
    </ListRow>
  );
}
