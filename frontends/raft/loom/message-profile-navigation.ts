// Narrow structural adaptation of raft-source a98ae003 MessageItem. The disk
// snapshot stays frozen; this explicit build-time change is NOT byte-exact reuse.
// Only a controlled agent-profile callback may bypass readonly navigation.
export function adaptMessageProfileNavigation(code: string) {
  const original =
    "testId={senderAvatarTestId}\n          onNavigateAgent={readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateAgent}";
  if (code.split(original).length !== 2)
    throw Error(
      "Official MessageItem profile boundary changed; review the adaptation",
    );
  return code.replace(
    original,
    'testId={senderAvatarTestId}\n          onNavigateAgent={onOpenProfile ? (id) => onOpenProfile("agent", id) : readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigateAgent}',
  );
}
