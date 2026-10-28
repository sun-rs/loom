import type { RahClient } from "@rah-os/client-sdk";
import { Card } from "raft-ui";
import WorkspaceMute from "./WorkspaceMute";
/** Web 1.21.35 tu: separate server-mute card. Kernel owns workspace preferences. */
export default function WorkspaceNotificationSettings(props: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
}) {
  return (
    <Card className="stack-y-3 p-4" data-testid="server-mute-card">
      <WorkspaceMute {...props} busy={false} />
    </Card>
  );
}
