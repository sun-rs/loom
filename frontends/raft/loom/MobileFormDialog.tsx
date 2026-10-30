import React, { type RefObject, type ReactNode } from "react";
import {
  Dialog,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "raft-ui";
import { DialogSheetContent } from "raft-ui/wip";
/** Official multi-field/long-content scenario; callsite width policy is forwarded.
 * Native counterpart: Mobile eff0472 RaftDialogSheet. Simple confirmations keep DialogContent. */
export default function MobileFormDialog({
  title,
  busy = false,
  onClose,
  testId,
  children,
  containerRef,
  initialFocus,
  contentClassName,
  wrapBody = true,
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  testId?: string;
  children: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  initialFocus?: RefObject<HTMLElement | null>;
  /** Explicit native callsite policy, e.g. AgentProfileEditDialog's max-w-lg. */
  contentClassName?: string;
  /** A form may provide its own native body/footer as siblings. */
  wrapBody?: boolean;
}) {
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogSheetContent
        ref={containerRef}
        data-testid={testId}
        initialFocus={initialFocus}
        className={contentClassName}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose disabled={busy} aria-label="关闭" />
        </DialogHeader>
        {wrapBody ? <DialogBody>{children}</DialogBody> : children}
      </DialogSheetContent>
    </Dialog>
  );
}
