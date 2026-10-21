import { createContext, useContext, type ComponentProps } from "react";
import type DiscoveryPage from "./DiscoveryPage.tsx";
import { LazyDiscoveryPage } from "./LazyPages.tsx";
export const OverlaySearchContext = createContext<ComponentProps<
  typeof DiscoveryPage
> | null>(null);
/** The native SearchOverlay remains intact; only its server-bound content is replaced. */
// Native flags are fixed here: overlay layout and result navigation are owned by
// LazyDiscoveryPage.overlay and the scoped OverlaySearchContext callbacks.
export default function SearchOverlayContent(_presentation: {
  activateResultsInChat: true;
  overlayChrome: true;
}) {
  const props = useContext(OverlaySearchContext);
  return props ? <LazyDiscoveryPage {...props} overlay /> : null;
}
