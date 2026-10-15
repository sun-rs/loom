import { createContext, useContext, type ComponentProps } from "react";
import DiscoveryPage from "./DiscoveryPage.tsx";
export const OverlaySearchContext = createContext<ComponentProps<
  typeof DiscoveryPage
> | null>(null);
/** The native SearchOverlay remains intact; only its server-bound content is replaced. */
export default function SearchOverlayContent() {
  const props = useContext(OverlaySearchContext);
  return props ? <DiscoveryPage {...props} overlay /> : null;
}
