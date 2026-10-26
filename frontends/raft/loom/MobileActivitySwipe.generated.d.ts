import type { HTMLAttributes } from "react";
export function useMobileActivitySwipe(options: {
  enabled: boolean;
  onStartSwipe?: () => void;
  actionsWidth: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFullSwipe: () => void;
  shouldYield?: () => boolean;
}): {
  ref: (element: HTMLElement | null) => void;
  handlers: HTMLAttributes<HTMLElement>;
};
export function suppressNextSwipeClick(event: PointerEvent): void;
export const swipeRowClass: string,
  swipeLayerClass: string,
  swipeDoneClass: string;

export const swipeSecondaryClass: string;

export const swipeAccessibleActionClass: string;
