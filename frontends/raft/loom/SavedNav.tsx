import { Bookmark } from "lucide-react";
import { SidebarItem } from "raft-ui";
import { useIntl } from "react-intl";
import {
  SavedNavCount,
  sidebarItemClass,
} from "../packages/web/src/components/layout/Sidebar.tsx";
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
    <SidebarItem
      variant="accent"
      active={active}
      onClick={onOpen}
      className={`${sidebarItemClass(active)} mb-1`}
      data-testid="sidebar-saved-entry"
    >
      <Bookmark size={14} className="shrink-0" />
      {formatMessage({ id: "layout.sidebar.saved" })}
      <SavedNavCount total={total} />
    </SidebarItem>
  );
}
