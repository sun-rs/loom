import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
// Native MachineDetailPanel inline edit composition; Loom revision/idempotency owner.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Pencil } from "lucide-react";
import { Button, Input, Textarea, Separator } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import type { LocalComputerObservation } from "@rah-os/protocol";
import { WriteIntentSlot } from "@rah-os/client-core/write-intent";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
export default function ComputerProfile({
  client,
  hostId,
  computer,
  onSaved,
}: {
  client: RahClient;
  hostId: string;
  computer: LocalComputerObservation;
  onSaved: () => void;
}) {
  const writes = useMemo(() => new WriteIntentSlot(), [client, hostId]);
  const [state, setState] = useState(writes.state);
  const [edit, setEdit] = useState<"name" | "description" | null>(null);
  const [base, setBase] = useState(computer);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  useRouteIntentOwner(writes);
  useEffect(() => {
    const stop = writes.onChange(setState);
    return () => {
      stop();
      writes.discard();
    };
  }, [writes]);
  useDraftNavigation(edit !== null, () => setEdit(null));
  const start = (field: "name" | "description") => {
    setBase(computer);
    setValue(
      field === "name" ? computer.displayName : (computer.description ?? ""),
    );
    setError("");
    setEdit(field);
  };
  const save = async () => {
    if (
      !edit ||
      writes.state !== "idle" ||
      !!error ||
      base.profileRevision === undefined ||
      (edit === "name" && !value.trim())
    )
      return;
    await writes.submitRevisioned({
      action: "computer-profile",
      payload: {
        hostId,
        expectedRevision: base.profileRevision,
        displayName: edit === "name" ? value.trim() : base.displayName,
        description:
          edit === "description"
            ? value.trim() || null
            : (base.description ?? null),
      },
      send: (payload, idempotencyKey) =>
        client.request("computer.profile.update", {
          ...payload,
          idempotencyKey,
        }),
      onSettled: (result) => {
        if (result.kind === "ok") {
          setEdit(null);
          setError("");
          onSaved();
        } else if (result.kind === "rejected") {
          setError("未保存：请取消后重新读取当前资料再编辑。");
          onSaved();
        }
      },
    });
  };
  const cancel = () => {
    if (writes.state !== "idle") return;
    setEdit(null);
    setError("");
  };
  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (
      event.key === "Enter" &&
      (edit === "name" || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      void save();
    }
  };
  return (
    <>
      {(["name", "description"] as const).map((field) => (
        <div key={field}>
          <Separator />
          <section className="px-5 py-4">
            <div className="flex items-center gap-2 mb-1">
              <SectionEyebrow>
                {field === "name" ? "名称" : "描述"}
              </SectionEyebrow>
              {!edit && computer.profileRevision !== undefined && (
                <Tooltip
                  content={
                    field === "name" ? "编辑计算机名称" : "编辑计算机描述"
                  }
                >
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={
                      field === "name" ? "编辑计算机名称" : "编辑计算机描述"
                    }
                    onClick={() => start(field)}
                  >
                    <Pencil size={14} />
                  </Button>
                </Tooltip>
              )}
            </div>
            {edit === field ? (
              <div className="space-y-2">
                {field === "name" ? (
                  <Input
                    autoFocus
                    onKeyDown={handleKeyDown}
                    className="w-full"
                    aria-label="计算机名称"
                    value={value}
                    maxLength={120}
                    disabled={state !== "idle"}
                    onChange={(e) => setValue(e.target.value)}
                  />
                ) : (
                  <Textarea
                    autoFocus
                    onKeyDown={handleKeyDown}
                    className="min-h-20 w-full resize-y"
                    aria-label="计算机描述"
                    value={value}
                    maxLength={500}
                    disabled={state !== "idle"}
                    onChange={(e) => setValue(e.target.value)}
                  />
                )}
                <div
                  className={
                    field === "description"
                      ? "flex items-center justify-between gap-2"
                      : undefined
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="accent"
                      disabled={
                        state !== "idle" ||
                        (field === "name" && !value.trim()) ||
                        !!error
                      }
                      onClick={() => void save()}
                    >
                      保存
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={state !== "idle"}
                      onClick={cancel}
                    >
                      取消
                    </Button>
                  </div>
                  {field === "description" && (
                    <span className="font-mono text-mono-meta text-foreground-hint">
                      {value.length}/500
                    </span>
                  )}
                </div>
                {error && (
                  <p role="alert" className="text-caption text-danger-strong">
                    {error}
                  </p>
                )}
                {state === "unknown" && (
                  <div role="alert">
                    结果未知，核实前暂停其他操作。
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void writes.retry()}
                    >
                      核实操作结果
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p
                className={`whitespace-pre-wrap text-callout ${field === "name" || computer.description ? "text-foreground" : "text-foreground-hint"}`}
              >
                {field === "name"
                  ? computer.displayName
                  : computer.description || "暂无描述"}
              </p>
            )}
          </section>
        </div>
      ))}
    </>
  );
}
