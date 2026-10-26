import { createContext, useContext } from "react";
/** Presentation-only return intent supplied by the existing URL router. */
export const MobilePageNavigation = createContext<(() => void) | undefined>(
  undefined,
);
export function useMobilePageBack() {
  return useContext(MobilePageNavigation);
}
