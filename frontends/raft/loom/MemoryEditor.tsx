import MobileFormDialog from "./MobileFormDialog";
import { DialogCommit } from "raft-ui/wip";
import { uiActionProps } from "./ui-action-props.ts";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import DiscardChangesDialog from "./DiscardChangesDialog.tsx";
import { useId, useState } from "react";
import { DialogFooter, Button, Input, Textarea } from "raft-ui";
import {
  ClientMemoryUpdateRequestSchema,
  type MemoryEntryDetail,
} from "@rah-os/protocol";
import type { MemoryClient } from "./memory-client.ts";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
export default function MemoryEditor({
  entry,
  owner,
  onClose,
  onSaved,
}: {
  entry: MemoryEntryDetail;
  owner: MemoryClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [description, setDescription] = useState(entry.description),
    [body, setBody] = useState(entry.body ?? ""),
    [error, setError] = useState("");
  const busy = owner.writes.state !== "idle";
  useDraftNavigation(
    description !== entry.description || body !== (entry.body ?? ""),
    onClose,
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (busy) return;
    if (description !== entry.description || body !== (entry.body ?? ""))
      setConfirmDiscard(true);
    else onClose();
  };
  return (
    <>
      <MobileFormDialog title="编辑记忆" busy={busy} onClose={requestClose}>
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            const parsed = ClientMemoryUpdateRequestSchema.safeParse({
              entryId: entry.entryId,
              expectedRevision: entry.revision,
              description,
              body,
              idempotencyKey: "precheck",
            });
            if (!parsed.success) {
              setError("简介需为 1–150 字，正文不能超过 16 KiB。");
              return;
            }
            setError("");
            void owner.update(entry, description, body, (outcome) => {
              if (outcome.kind === "ok") onSaved();
              else
                setError(
                  outcome.kind === "unknown"
                    ? "保存结果未知，请核实原操作。"
                    : "保存未完成。若记忆已被修改，请保留草稿并关闭后刷新，再重新编辑。",
                );
            });
          }}
        >
          <FormField label="简介">
            <Input
              aria-label="记忆简介"
              maxLength={150}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <FormField label="正文" className="mt-4">
            <Textarea
              aria-label="记忆正文"
              rows={12}
              value={body}
              disabled={busy}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>
          {error && (
            <p role="alert" className="mt-3 text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              {...uiActionProps.formCancel}
              type="button"
              disabled={busy}
              onClick={requestClose}
            >
              取消
            </Button>
            <DialogCommit
              form={formId}
              {...uiActionProps.formSave}
              type="submit"
              disabled={
                busy ||
                (body === entry.body && description === entry.description)
              }
            >
              保存记忆
            </DialogCommit>
          </DialogFooter>
          {owner.writes.state === "unknown" && (
            <div className="mt-3 flex gap-2">
              <Button
                {...uiActionProps.recovery}
                type="button"
                onClick={() => void owner.writes.retry()}
              >
                核实原操作
              </Button>
              <Button
                {...uiActionProps.recovery}
                type="button"
                onClick={() => {
                  owner.writes.discard();
                  onClose();
                }}
              >
                放弃核实
              </Button>
            </div>
          )}
        </form>
      </MobileFormDialog>
      {confirmDiscard && (
        <DiscardChangesDialog
          onCancel={() => setConfirmDiscard(false)}
          onDiscard={onClose}
        />
      )}
    </>
  );
}
