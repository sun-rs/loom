export function adaptMessageStatus(code: string) {
  const seam =
    "const isDeactivatedAgent = isAgent && !!senderAgent?.deletedAt;";
  if (code.split(seam).length !== 2)
    throw Error("Official sender lifecycle seam changed");
  code =
    'import { useLoomMessageState } from "loom-appearance";\nimport { MessageInstanceStatusDot, useMessageInstanceState } from "loom-message-profile";\n' +
    code.replace(
      seam,
      'const loomInstanceState = useLoomMessageState(message.channelId, message.senderId);\n  const isDeactivatedAgent = isAgent && (readOnlyProjection ? loomInstanceState === "left" : !!senderAgent?.deletedAt);',
    );
  code = code.replace(
    "<AgentStatusDot agentId={senderId} fallbackAgent={hoverAgent} />",
    "<MessageInstanceStatusDot agentId={senderId} />",
  );
  code = code.replace(
    '{formatMessage({ id: "message.messageItem.deletedBadge" })}',
    '{readOnlyProjection ? "已离开" : formatMessage({ id: "message.messageItem.deletedBadge" })}',
  );
  code = code.replace(
    'const mentionType = showAgent ? "agent" : "user";',
    'const loomAvatarState = useMessageInstanceState(senderId);\n  const mentionType = showAgent ? "agent" : "user";',
  );
  code = code.replace(
    "badge={!isDeactivatedAgent ? (",
    'badge={!isDeactivatedAgent && loomAvatarState !== "unknown" && loomAvatarState !== "left" ? (',
  );
  return code;
}
