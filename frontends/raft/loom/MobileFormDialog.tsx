import React, { type RefObject, type ReactNode } from "react";
import {
  Dialog,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "raft-ui";
import { DialogSheetContent } from "raft-ui/wip";
/** Official 0.35.1 multi-field/long-content scenario. No sizing or keyboard owner here.
 * Native counterpart: Mobile eff0472 RaftDialogSheet. Simple confirmations keep DialogContent. */
export default function MobileFormDialog({
  title,
  busy = false,
  onClose,
  testId,
  children,
  containerRef,
  initialFocus,
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  testId?: string;
  children: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  initialFocus?: RefObject<HTMLElement | null>;
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
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose disabled={busy} aria-label="关闭" />
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
      </DialogSheetContent>
    </Dialog>
  );
}
