import {
  ListRowGroup,
  ListRow,
  ListRowBody,
  ListRowTitle,
  ListRowDescription,
  ListRowChevron,
} from "raft-ui";
/** Structural port of 1.21.34 SettingsPanel-Cg0my9Pp.js Sl.
 * Official row/spacing; current-workspace wording and navigation callback replace server store. */
export default function WorkspaceThemeLink({ onOpen }: { onOpen: () => void }) {
  return (
    <ListRowGroup className="mb-6">
      <ListRow
        variant="plain"
        onClick={onOpen}
        data-testid="settings-server-theme-link"
      >
        <ListRowBody>
          <ListRowTitle>当前工作区的主题</ListRowTitle>
          <ListRowDescription wrap>
            每个工作区可以用不同的主题。
          </ListRowDescription>
        </ListRowBody>
        <ListRowChevron />
      </ListRow>
    </ListRowGroup>
  );
}
