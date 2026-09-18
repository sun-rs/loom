import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { RoomSession, runRoomMutationAtLatest } from "@rah-os/client-core";
import type { RoomExecutionReadResponse } from "@rah-os/protocol";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { composerPrimaryAction } from "../composer-controls.ts";
import "../composer-controls.css";

export function ComposerSubmitControl({
  client,
  roomId,
  body,
  attachmentCount,
  sendDisabled,
  stopAllowed,
  label = "发送",
}: {
  client: RahClient;
  roomId: string | undefined;
  body: string;
  attachmentCount: number;
  sendDisabled: boolean;
  stopAllowed: boolean;
  label?: string;
}) {
  const [state, setState] = useState<{
    roomId: string;
    status: RoomExecutionReadResponse;
  }>();
  const [pendingRoom, setPendingRoom] = useState<string>();
  const [error, setError] = useState<string>();
  const active = useRef(roomId);
  active.current = roomId;
  useEffect(() => {
    if (!roomId || !stopAllowed) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const status = await client.request(
          "room.execution.read",
          { roomId: roomId! },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setState({ roomId: roomId!, status });
      } catch {
        /* A disconnected client must not invent a completed stop. */
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 1000);
    }
    setError(undefined);
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, roomId, stopAllowed]);
  const status = state?.roomId === roomId ? state?.status : undefined;
  const action = composerPrimaryAction({
    body,
    attachmentCount,
    working: !!status?.working,
    stopping:
      (roomId !== undefined && pendingRoom === roomId) ||
      status?.operation?.state === "stopping",
  });
  async function stop() {
    if (!roomId || !stopAllowed || pendingRoom === roomId) return;
    setPendingRoom(roomId);
    setError(undefined);
    try {
      const session = new RoomSession({
        client,
        roomId,
        consumerId: `composer-stop-${crypto.randomUUID()}`,
      });
      const idempotencyKey = crypto.randomUUID();
      await runRoomMutationAtLatest({
        session,
        mutate: (basedOnRoomSeq) =>
          client.request("room.sos.stop", {
            roomId,
            basedOnRoomSeq,
            idempotencyKey,
            resumeOnMessage: true,
          }),
      });
      const latest = await client.request("room.execution.read", { roomId });
      if (active.current === roomId) setState({ roomId, status: latest });
    } catch (reason) {
      if (active.current === roomId)
        setError(reason instanceof Error ? reason.message : "停止失败，请重试");
    } finally {
      setPendingRoom((value) => (value === roomId ? undefined : value));
    }
  }
  const title =
    action === "stop"
      ? "停止当前对话的执行"
      : action === "stopping"
        ? "正在停止当前对话"
        : label;
  return (
    <span className="rah-composer-execution">
      {error && (
        <span role="alert" title={error}>
          {error}
        </span>
      )}
      <button
        className="send-btn"
        data-action={action}
        type={action === "send" ? "submit" : "button"}
        disabled={
          action === "send"
            ? sendDisabled
            : action === "stopping" || !stopAllowed
        }
        title={title}
        aria-label={title}
        aria-busy={action === "stopping"}
        onClick={action === "stop" ? () => void stop() : undefined}
      >
        <Icon name={action === "send" ? "send" : "circle-stop"} />
      </button>
    </span>
  );
}
