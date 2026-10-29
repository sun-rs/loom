import { Bookmark } from "lucide-react";
import {
  SidebarItem,
  SidebarItemIcon,
  SidebarSection,
  SidebarList,
} from "raft-ui";
import { sidebarItemClass139 } from "./OfficialSidebar139.generated.js";
import { useIntl } from "react-intl";
import { SavedNavCount } from "./OfficialNavigationLeaves.generated";
import type { RahClient } from "@rah-os/client-sdk";
import { useEffect, useState } from "react";
export default function SavedNav({
  client,
  workspaceId,
  active,
  onOpen,
}: {
  client: RahClient;
  workspaceId: string;
  active: boolean;
  onOpen: () => void;
}) {
  const { formatMessage } = useIntl(),
    [total, setTotal] = useState(0);
  useEffect(() => {
    let version = 0,
      disposed = false;
    const read = async () => {
      const ticket = ++version;
      try {
        const result = await client.request("message.saved", {
          workspaceId,
          limit: 1,
          sortDirection: "desc",
        });
        if (!disposed && ticket === version) setTotal(result.globalTotal);
      } catch {
        /* Keep last confirmed count; panel exposes read errors. */
      }
    };
    void read();
    window.addEventListener("loom:saved-changed", read);
    window.addEventListener("focus", read);
    return () => {
      disposed = true;
      window.removeEventListener("loom:saved-changed", read);
      window.removeEventListener("focus", read);
    };
  }, [client, workspaceId]);
  return (
    <SidebarSection>
      <SidebarList>
        <SidebarItem
          active={active}
          onClick={onOpen}
          className={`${sidebarItemClass139(active)} loom-mobile-home-action`}
          data-testid="sidebar-saved-entry"
        >
          <SidebarItemIcon>
            <Bookmark />
          </SidebarItemIcon>
          {formatMessage({ id: "layout.sidebar.saved" })}
          <SavedNavCount total={total} />
        </SidebarItem>
      </SidebarList>
    </SidebarSection>
  );
}
