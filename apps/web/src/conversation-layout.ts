/** Shared width-only presentation. Resizing never changes navigation intent. */
export function conversationLayout(
  width: number,
  _height: number,
  navigationWidth: number,
  panelKind: "thread" | "profile" = "thread",
) {
  if (width < 768) return "fullscreen";
  return width - navigationWidth >= (panelKind === "profile" ? 620 : 680)
    ? "split"
    : "replace";
}
