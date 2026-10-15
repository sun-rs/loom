import { useCallback, useEffect, useState, type ComponentProps } from "react";
import type { Principal } from "@rah-os/protocol";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import ThreadWorkspace from "./ThreadWorkspace.tsx";
import InstanceInspector from "./InstanceInspector.tsx";

/** MainLayout's content-thread + ProfilePanel wrapper composition. No independent thread state. */
export default function ThreadContentSlot({
  controlRoomId,
  onProfileVisibilityChange,
  ...props
}: ComponentProps<typeof ThreadWorkspace> & {
  controlRoomId: string;
  onProfileVisibilityChange: (open: boolean) => void;
}) {
  const [member, setMember] = useState<Principal>();
  useEffect(() => {
    onProfileVisibilityChange(!!member);
    return () => onProfileVisibilityChange(false);
  }, [!!member, onProfileVisibilityChange]);
  const close = useCallback(() => {
    if (!hasUnresolvedIntents()) setMember(undefined);
  }, []);
  return (
    <div className="thread-layout-container relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ThreadWorkspace
        {...props}
        contentSlot
        covered={!!member}
        onOpenProfile={(next) => {
          if (!hasUnresolvedIntents()) setMember(next);
        }}
      />
      {member && (
        <div
          className="thread-profile-side-column contents"
          data-collapse-channel="false"
          data-collapse-thread="false"
        >
          <InstanceInspector
            client={props.client}
            controlRoomId={controlRoomId}
            room={props.room}
            member={member}
            onClose={close}
          />
        </div>
      )}
    </div>
  );
}
