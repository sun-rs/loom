/** Shared width-only presentation. Resizing never changes navigation intent. */
export function conversationLayout(
  width: number,
  _height: number,
  navigationWidth: number,
) {
  if (width < 768) return "fullscreen";
  return width - navigationWidth >= 680 ? "split" : "replace";
}
