import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { DiscoveryLocation } from "../global-discovery-model.ts";
import {
  diagnosticReferenceParts,
  type DiagnosticTarget,
  type DiagnosticRoom,
} from "../diagnostic-references.ts";
import { createLatestRequest } from "../latest-request.ts";

export const DiagnosticNavigationContext = createContext<
  | {
      client: RahClient;
      rooms: readonly DiagnosticRoom[];
      onOpen: (location: DiscoveryLocation) => void;
      navigationEpoch: () => number;
      beginNavigation: () => number;
      requestGate: ReturnType<typeof createLatestRequest>;
    }
  | undefined
>(undefined);

export function DiagnosticReferences({ text }: { text: string }) {
  const context = useContext(DiagnosticNavigationContext);
  const ownRequest = useRef<
    ReturnType<ReturnType<typeof createLatestRequest>["begin"]> | undefined
  >(undefined);
  const [error, setError] = useState<string>();
  useEffect(() => () => ownRequest.current?.cancel(), [context?.client]);
  if (!context) return <>{text}</>;
  async function open(target: DiagnosticTarget) {
    if (!context) return;
    const epoch = context.beginNavigation();
    const href = window.location.href;
    const request = context.requestGate.begin(
      () =>
        context.navigationEpoch() === epoch && window.location.href === href,
    );
    ownRequest.current = request;
    setError(undefined);
    try {
      if (!target.messageId) {
        context.onOpen({ roomId: target.roomId });
        return;
      }
      const result = await context.client.request(
        "message.context",
        { roomId: target.roomId, messageId: target.messageId },
        { signal: request.signal },
      );
      if (request.current())
        context.onOpen({
          roomId: result.message.roomId,
          messageId: result.message.messageId,
          ...(result.rootMessageId
            ? { rootMessageId: result.rootMessageId }
            : {}),
        });
    } catch {
      if (request.current()) setError("引用不可用、存在歧义或无权查看");
    }
  }
  return (
    <>
      {diagnosticReferenceParts(text, context.rooms).map((part, index) =>
        part.target ? (
          <button
            className="rah-diagnostic-target"
            key={index}
            onClick={() => void open(part.target!)}
            title="打开引用的对话或消息列"
          >
            {part.text}
          </button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
      {error && <small role="status">{error}</small>}
    </>
  );
}
