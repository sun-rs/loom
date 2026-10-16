// Native Dialog/FormField/Select/Switch composition; Kernel owns effective access.
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Switch,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogClose,
} from "raft-ui";
import type { MemoryPolicy } from "@rah-os/protocol";
import type { LoomChannelClient } from "./channel-client.ts";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import { SelectField } from "./ManagementUi.tsx";
import { MemoryPolicyClient, policyPatch } from "./memory-policy.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
const choices = [
  { value: "inherit", label: "跟随频道" },
  { value: "on", label: "允许" },
  { value: "off", label: "禁止" },
];
const value = (v: boolean | null | undefined) =>
  v === true ? "on" : v === false ? "off" : "inherit";
export default function MemoryPolicyDialog({
  bridge,
  onClose,
}: {
  bridge: LoomChannelClient;
  onClose: () => void;
}) {
  const owner = useMemo(() => new MemoryPolicyClient(bridge.client), [bridge]);
  const [state, setState] = useState(owner.writes.state),
    [base, setBase] = useState<MemoryPolicy>(),
    [draft, setDraft] = useState<MemoryPolicy>(),
    [members, setMembers] = useState<
      Awaited<ReturnType<LoomChannelClient["members"]>>
    >([]),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const busy = state !== "idle";
  useRouteIntentOwner(owner.writes);
  useEffect(() => {
    const stop = owner.writes.onChange(setState);
    return () => {
      stop();
      owner.writes.discard();
    };
  }, [owner]);
  useEffect(() => {
    const abort = new AbortController();
    setBase(undefined);
    setDraft(undefined);
    setError("");
    void Promise.all([
      bridge.client.request(
        "memory.policy.read",
        { channelId: bridge.roomId },
        { signal: abort.signal },
      ),
      bridge.members(abort.signal),
    ])
      .then(([policy, rows]) => {
        if (!abort.signal.aborted) {
          setBase(policy);
          setDraft(policy);
          setMembers(rows);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("无法读取记忆权限，请重试。");
      });
    return () => abort.abort();
  }, [bridge, tick]);
  const override = (
    instanceId: string,
    key: "read" | "write",
    choice: string,
  ) => {
    if (!draft || busy) return;
    const old = draft.overrides.find((r) => r.instanceId === instanceId) ?? {
      instanceId,
      read: null,
      write: null,
    };
    setDraft({
      ...draft,
      overrides: [
        ...draft.overrides.filter((r) => r.instanceId !== instanceId),
        { ...old, [key]: choice === "inherit" ? null : choice === "on" },
      ],
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>频道记忆权限</DialogTitle>
          <DialogClose disabled={busy} aria-label="关闭记忆权限" />
        </DialogHeader>
        <DialogBody>
          <p className="mb-4 text-sm text-foreground-muted">
            记忆由频道成员共享，私聊中写入的记忆也属于频道。关闭读取不会撤回已进入会话的内容。
          </p>
          {!draft && !error && <p role="status">正在读取记忆权限…</p>}
          {draft && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!base || busy) return;
                setError("");
                void owner.save(base, draft, (outcome) => {
                  if (outcome.kind === "ok") onClose();
                  else
                    setError(
                      outcome.kind === "unknown"
                        ? "保存结果未知，请核实原操作。"
                        : "保存未完成，权限可能已变化。请重新读取后修改。",
                    );
                });
              }}
            >
              <div className="mb-5 grid grid-cols-2 gap-4">
                <FormField label="默认读取">
                  <Switch
                    aria-label="默认读取"
                    checked={draft.readDefault}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, readDefault: v })
                    }
                  />
                </FormField>
                <FormField label="默认写入">
                  <Switch
                    aria-label="默认写入"
                    checked={draft.writeDefault}
                    disabled={busy}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, writeDefault: v })
                    }
                  />
                </FormField>
              </div>
              {draft.members.length === 0 && (
                <p className="mb-4 text-sm">暂无实例成员</p>
              )}
              {draft.members.map((member) => {
                const row = draft.overrides.find(
                  (r) => r.instanceId === member.instanceId,
                );
                const name =
                  members.find((r) => r.id === member.instanceId)?.name ??
                  "已离开的成员";
                return (
                  <div
                    key={member.instanceId}
                    className="mb-4 border-t border-line-muted theme-brutal:border-black/10 pt-3"
                  >
                    <p className="mb-2 text-sm font-bold">{name}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <SelectField
                        label={`${name} 读取`}
                        value={value(row?.read)}
                        options={choices}
                        disabled={busy}
                        onChange={(v) => override(member.instanceId, "read", v)}
                      />
                      <SelectField
                        label={`${name} 写入`}
                        value={value(row?.write)}
                        options={choices}
                        disabled={busy}
                        onChange={(v) =>
                          override(member.instanceId, "write", v)
                        }
                      />
                    </div>
                    <p className="text-xs text-foreground-muted">
                      保存后：读取
                      {(row?.read ?? draft.readDefault) ? "允许" : "禁止"} ·
                      写入{(row?.write ?? draft.writeDefault) ? "允许" : "禁止"}
                    </p>
                  </div>
                );
              })}
              <Button
                type="submit"
                disabled={busy || !base || !policyPatch(base, draft)}
              >
                保存权限
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm">
              {error}
            </p>
          )}
          {error && state === "idle" && (
            <Button variant="ghost" onClick={() => setTick((v) => v + 1)}>
              重新读取权限
            </Button>
          )}
          {state === "unknown" && (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void owner.writes.retry()}>
                核实原操作
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  owner.writes.discard();
                  onClose();
                }}
              >
                放弃核实
              </Button>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
