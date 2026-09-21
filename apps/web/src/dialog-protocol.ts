import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useDialogProtocol(input: {
  blocked: boolean;
  initialFocus?: "container" | "first";
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const blockedRef = useRef(input.blocked);
  const initialFocusRef = useRef(input.initialFocus ?? "first");
  const onCloseRef = useRef(input.onClose);
  blockedRef.current = input.blocked;
  onCloseRef.current = input.onClose;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const topDialog = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        ),
      ].at(-1);
      if (topDialog !== dialogRef.current) return;
      if (event.key === "Escape" && !blockedRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        ) ?? []),
      ].filter(
        (element) =>
          element.tabIndex >= 0 &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden" &&
          !element.closest("[inert]"),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialogRef.current ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    queueMicrotask(() => {
      if (dialogRef.current?.contains(document.activeElement)) return;
      if (initialFocusRef.current === "container") {
        dialogRef.current?.focus();
        return;
      }
      const marked = dialogRef.current?.querySelector<HTMLElement>(
        "[data-dialog-initial-focus]",
      );
      (
        marked ??
        dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      )?.focus();
    });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, []);

  return dialogRef;
}
