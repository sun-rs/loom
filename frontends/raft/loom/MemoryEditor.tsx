import { useState } from "react";
import {
  Button,
  Input,
  Textarea,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogBody,
} from "raft-ui";
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
  const [description, setDescription] = useState(entry.description),
    [body, setBody] = useState(entry.body ?? ""),
    [error, setError] = useState("");
  const busy = owner.writes.state !== "idle";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑记忆</DialogTitle>
          <DialogClose disabled={busy} aria-label="关闭编辑" />
        </DialogHeader>
        <DialogBody>
          <form
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
            <div className="mt-4 flex gap-2">
              <Button
                type="submit"
                disabled={
                  busy ||
                  (body === entry.body && description === entry.description)
                }
              >
                保存记忆
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </Button>
            </div>
            {owner.writes.state === "unknown" && (
              <div className="mt-3 flex gap-2">
                <Button type="button" onClick={() => void owner.writes.retry()}>
                  核实原操作
                </Button>
                <Button
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
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
