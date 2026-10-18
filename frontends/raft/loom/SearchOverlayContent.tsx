import { createContext, useContext, type ComponentProps } from "react";
import type DiscoveryPage from "./DiscoveryPage.tsx";
import { LazyDiscoveryPage } from "./LazyPages.tsx";
export const OverlaySearchContext = createContext<ComponentProps<
  typeof DiscoveryPage
> | null>(null);
/** The native SearchOverlay remains intact; only its server-bound content is replaced. */
export default function SearchOverlayContent() {
  const props = useContext(OverlaySearchContext);
  return props ? <LazyDiscoveryPage {...props} overlay /> : null;
}
