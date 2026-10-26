/** Official mobile content baseline is 14sp. Preserve explicit Web preference.
 * Do not persist this device default or override Safari-safe input typography. */
export function adaptMobileMessageDefault(source: string) {
  const seam =
    "return normalizeMessageBodyFontSize(localStorage.getItem(MESSAGE_BODY_FONT_SIZE_STORAGE_KEY));";
  if (source.split(seam).length !== 2)
    throw Error("Official message preference seam changed");
  return source.replace(
    seam,
    'return normalizeMessageBodyFontSize(localStorage.getItem(MESSAGE_BODY_FONT_SIZE_STORAGE_KEY) ?? (typeof window !== "undefined" && window.matchMedia("(max-width: 767px), (pointer: coarse)").matches ? "sm" : null));',
  );
}
