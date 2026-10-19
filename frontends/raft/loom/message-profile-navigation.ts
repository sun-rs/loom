// Explicit Loom callback bridge over official readonly projections. No upstream
// store navigation is enabled; unknown/absent callbacks retain readonly guards.
export function adaptMessageProfileNavigation(code: string) {
  for (const [kind, target] of [
    ["Agent", "agent"],
    ["Human", "human"],
  ] as const) {
    const original = `onNavigate${kind}={readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigate${kind}}`;
    if (code.split(original).length !== 4)
      throw Error(
        "Official MessageItem profile boundary changed; review the adaptation",
      );
    code = code.replaceAll(
      original,
      `onNavigate${kind}={onOpenProfile ? (id) => onOpenProfile("${target}", id) : readOnlyProjection ? ignoreReadOnlyProjectionNavigation : handleNavigate${kind}}`,
    );
  }
  // Safari does not focus buttons on pointer click. The Loom inspector uses
  // the focused opener to restore keyboard navigation on close.
  const avatarClick = "onClick={onClickAgent}";
  if (code.split(avatarClick).length !== 2)
    throw Error("Official agent avatar click changed; review focus bridge");
  return code.replace(
    avatarClick,
    "onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onClickAgent(); }}",
  );
}
