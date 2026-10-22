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
  // The official sender menu only copies identity labels. Authenticated Loom
  // timelines may expose it without enabling upstream message mutations.
  const senderMenu =
    "onContextMenu={readOnlyProjection ? undefined : handleSenderContextMenu}";
  if (code.split(senderMenu).length !== 4)
    throw Error("Official sender context menu boundary changed");
  code = code.replaceAll(
    senderMenu,
    "onContextMenu={readOnlyProjection && !onOpenProfile ? undefined : handleSenderContextMenu}",
  );
  const closeMenu =
    "const closeSenderCtxMenu = useCallback(() => setSenderCtxMenu(null), []);";
  if (code.split(closeMenu).length !== 2)
    throw Error("Official sender dismissal boundary changed");
  code = code.replace(
    closeMenu,
    `${closeMenu}
  // Loom authenticated menu lifecycle; native backdrop handles outside press.
  useEffect(() => {
    if (!senderCtxMenu) return;
    const focused = document.activeElement as HTMLElement | null;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeSenderCtxMenu();
      focused?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [senderCtxMenu, closeSenderCtxMenu]);
  // End Loom authenticated menu lifecycle.
`,
  );
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
