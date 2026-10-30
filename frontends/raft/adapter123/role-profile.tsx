import { useState, useRef, useEffect } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  Textarea,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@botiverse/raft-ui";
import { Pencil, X } from "lucide-react";
import NativeProfileEditor from "../upstream/web-1.21.23/packages/web/src/components/agent/AgentProfileEditDialog.tsx";
import type { AgentProfileEditDialogProps } from "../upstream/web-1.21.23/packages/web/src/components/agent/AgentProfileEditDialog.tsx";
import FormField from "../upstream/web-1.21.23/packages/web/src/components/ui/FormField.tsx";
import SectionEyebrow from "../upstream/web-1.21.23/packages/web/src/components/ui/SectionEyebrow.tsx";
import { useAgentStore } from "./runtime-agent-store.ts";
import { bridge } from "./api.ts";
type RoleView = AgentProfileEditDialogProps["agent"] & {
  loomRoleId?: string;
  loomPrompt?: string;
  loomRoleRevisionId?: string;
};
/** Loom-only prompt field; the native Dialog/field/footer own all geometry. */
function RoleEditor({
  agent,
  focus,
  onClose,
}: {
  agent: RoleView;
  focus: "description" | "prompt";
  onClose: () => void;
}) {
  const [description, setDescription] = useState(agent.description ?? ""),
    [prompt, setPrompt] = useState(agent.loomPrompt ?? ""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false);
  const [base, setBase] = useState<RoleView | null>(
    agent.loomPrompt === undefined ? null : agent,
  );
  useEffect(() => {
    if (agent.loomPrompt !== undefined) return;
    let active = true;
    void bridge
      .agent(agent.id)
      .then((value) => {
        if (active) {
          const detail = value as unknown as RoleView;
          setDescription(detail.description ?? "");
          setPrompt(detail.loomPrompt ?? "");
          setBase(detail);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [agent.id]);
  const descriptionRef = useRef<HTMLTextAreaElement>(null),
    promptRef = useRef<HTMLTextAreaElement>(null),
    dirty =
      !!base &&
      (description !== (base.description ?? "") ||
        prompt !== (base.loomPrompt ?? ""));
  const close = () => {
    if (saving) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const save = async () => {
    if (!base) return;
    setSaving(true);
    setError("");
    try {
      await useAgentStore.getState().updateAgent(agent.id, {
        description,
        loomPrompt: prompt,
        loomExpectedRoleRevisionId: base.loomRoleRevisionId,
      } as any);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="max-w-lg"
          initialFocus={focus === "prompt" ? promptRef : descriptionRef}
          data-testid="loom-role-editor"
        >
          <DialogHeader>
            <DialogTitle>描述和提示词</DialogTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="关闭"
              onClick={close}
              disabled={saving}
            >
              <X className="size-4.5" />
            </Button>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <FormField label="描述" htmlFor="loom-role-description">
              <Textarea
                ref={descriptionRef}
                id="loom-role-description"
                rows={3}
                value={description}
                readOnly={!base}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="仅用于备注，不发送给模型"
              />
            </FormField>
            <FormField label="提示词" htmlFor="loom-role-prompt">
              <Textarea
                ref={promptRef}
                id="loom-role-prompt"
                rows={5}
                value={prompt}
                readOnly={!base}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="角色提示词（可留空）"
              />
            </FormField>
            {error && (
              <p role="alert" className="text-footnote text-danger-strong">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" size="lg" onClick={close} disabled={saving}>
              取消
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void save()}
              disabled={saving || !dirty || description.length > 3000}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>尚未保存的描述和提示词将丢失。</AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDiscard(false)}>
              继续编辑
            </AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>放弃修改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
export default function ProfileEditor(props: AgentProfileEditDialogProps) {
  const agent = props.agent as RoleView;
  return agent.loomRoleId && props.field === "description" ? (
    <RoleEditor agent={agent} focus="description" onClose={props.onClose} />
  ) : (
    <NativeProfileEditor {...props} />
  );
}
export function RoleInstructions({ agent }: { agent: RoleView }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<RoleView | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!agent.loomRoleId) return;
    let active = true;
    void bridge
      .agent(agent.id)
      .then((value) => {
        if (active) {
          setDetail(value as unknown as RoleView);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [agent.id, agent.loomRoleId, agent.loomRoleRevisionId]);
  if (!agent.loomRoleId) return null;
  return (
    <div className="px-5 py-4" data-testid="loom-role-instructions">
      <div className="mb-2 flex items-center justify-between">
        <SectionEyebrow>提示词</SectionEyebrow>
        {!agent.deletedAt && detail && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="编辑提示词"
            onClick={() => setOpen(true)}
          >
            <Pencil size={14} />
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-subhead text-foreground">
        {error || (!detail ? "正在读取提示词…" : detail.loomPrompt) || (
          <span className="text-foreground-hint">未设置提示词</span>
        )}
      </p>
      {open && detail && (
        <RoleEditor
          agent={detail}
          focus="prompt"
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
