/** Loom Web binding of pinned Raft Mobile adaptive policy.
 * Native 840dp is mapped to CSS logical px, never device pixels. Primary touch
 * keeps native density at every width; fine/none pointers retain official Web.
 * Source: raft-mobile-source RaftAdaptivePane.kt; see native-adaptive-bindings.
 */
export const NATIVE_DUAL_MIN = 840;
export const layoutQueries = {
  dual: `(((width >= 768px) and (not (pointer: coarse))) or ((width >= ${NATIVE_DUAL_MIN}px) and (pointer: coarse)))`,
  single: `(((width < 768px) and (not (pointer: coarse))) or ((width < ${NATIVE_DUAL_MIN}px) and (pointer: coarse)))`,
  compactDensity: "(max-width: 767px), (pointer: coarse)",
};
export function adaptiveLayout(width: number, touch: boolean) {
  return {
    dual: width >= (touch ? NATIVE_DUAL_MIN : 768),
    compactDensity: touch || width < 768,
  };
}
/** Build-only compatibility seam over responsive media, not upstream mutation.
 * Only the md layout boundary is mapped; other breakpoints, selectors and
 * pointer/hover predicates stay intact. CSS and local media subscriptions must
 * agree or a hidden pane can remain the active routing owner.
 */
export function adaptLayoutMedia(query: string): string {
  return query
    .replace(
      /\((?:min-width\s*:\s*(?:768px|48rem)|width\s*>=\s*(?:48rem|768px))\)/g,
      layoutQueries.dual,
    )
    .replace(
      /\((?:max-width\s*:\s*767(?:\.98)?px|width\s*<\s*(?:48rem|768px)|width\s*<=\s*767(?:\.98)?px)\)/g,
      layoutQueries.single,
    );
}
