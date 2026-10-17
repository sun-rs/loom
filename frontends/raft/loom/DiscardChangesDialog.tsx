// Structural port of AgentProfileEditDialog's discard confirmation; official primitives.
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "raft-ui";
export default function DiscardChangesDialog({
  onCancel,
  onDiscard,
}: {
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>尚未保存的修改</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>离开将放弃尚未保存的修改。</AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">继续编辑</AlertDialogCancel>
          <AlertDialogAction variant="danger" size="sm" onClick={onDiscard}>
            放弃修改
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
