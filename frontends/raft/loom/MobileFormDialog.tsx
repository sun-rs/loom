import React, { type ReactNode } from "react";
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
}: {
  title: string;
  busy?: boolean;
  onClose: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogSheetContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose disabled={busy} aria-label="关闭" />
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
      </DialogSheetContent>
    </Dialog>
  );
}
