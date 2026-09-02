import { useCallback, useRef } from "react";

type ConnectedTarget = Readonly<{ isConnected: boolean }>;

export function chooseThreadFocusReturnTarget<T extends ConnectedTarget>(
  opener: T | null | undefined,
  root: T | null | undefined,
): T | undefined {
  if (opener?.isConnected) return opener;
  if (root?.isConnected) return root;
  return undefined;
}

export function useThreadFocusReturn() {
  const openerRef = useRef<HTMLElement | undefined>(undefined);

  const rememberThreadFocus = useCallback(
    (explicitTarget?: HTMLElement | null) => {
      const activeTarget =
        explicitTarget ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined);
      openerRef.current =
        activeTarget === document.body ? undefined : activeTarget;
    },
    [],
  );

  const restoreThreadFocus = useCallback((rootMessageId?: string) => {
    const opener = openerRef.current;
    openerRef.current = undefined;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const root = rootMessageId
          ? Array.from(
              document.querySelectorAll<HTMLElement>("[data-message-id]"),
            ).find((element) => element.dataset.messageId === rootMessageId)
          : undefined;
        chooseThreadFocusReturnTarget(opener, root)?.focus();
      });
    });
  }, []);

  return { rememberThreadFocus, restoreThreadFocus };
}
