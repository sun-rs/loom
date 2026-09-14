import { browserOpaqueId } from "./browser-opaque-id.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Workspace } from "@rah-os/protocol";
import { createLatestRequest } from "./latest-request.ts";

/** Local draft only. The control Room and mutation receipt own its causal version. */
export function useWorkspaceProfileEdit(
  client: RahClient,
  workspace: Workspace | undefined,
  canManage: boolean,
  onUpdated: (workspace: Workspace) => void,
) {
  const scope = useMemo(
    () => ({}),
    [client, workspace?.workspaceId, workspace?.controlRoomId],
  );
  const current = useRef(scope);
  current.current = scope;
  const mounted = useRef(true);
  const busy = useRef(false);
  const reads = useRef(createLatestRequest());
  const [name, setName] = useState(workspace?.name ?? "");
  const [avatarKey, setAvatarKey] = useState(workspace?.avatarKey ?? "");
  const [avatarUploadIntentId, setIntent] = useState<string>();
  const [saved, setSaved] = useState(workspace);
  const [baseline, setBaseline] = useState<{ scope: object; seq: number }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const dirty =
    name.trim() !== (saved?.name ?? "").trim() ||
    avatarKey !== (saved?.avatarKey ?? "");
  const isCurrent = () => mounted.current && current.current === scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const readBaseline = useCallback(
    async (signal?: AbortSignal) => {
      if (!workspace?.controlRoomId) return;
      const ticket = reads.current.begin();
      setBaseline(undefined);
      setError(undefined);
      try {
        const response = await client.request(
          "room.sync",
          {
            afterSeq: 0,
            consumerId: `settings-profile-${workspace.workspaceId}`,
            limit: 1,
            roomId: workspace.controlRoomId,
          },
          signal ? { signal } : undefined,
        );
        if (
          mounted.current &&
          current.current === scope &&
          !signal?.aborted &&
          ticket.current()
        )
          setBaseline({ scope, seq: response.latestRoomSeq });
      } catch (cause) {
        if (
          mounted.current &&
          current.current === scope &&
          !signal?.aborted &&
          ticket.current()
        )
          setError(cause instanceof Error ? cause.message : "无法读取空间版本");
      }
    },
    [client, scope, workspace?.workspaceId, workspace?.controlRoomId],
  );
  useEffect(() => {
    busy.current = false;
    setPending(false);
    setName(workspace?.name ?? "");
    setAvatarKey(workspace?.avatarKey ?? "");
    setIntent(undefined);
    setSaved(workspace);
    const controller = new AbortController();
    void readBaseline(controller.signal);
    return () => {
      controller.abort();
      reads.current.cancel();
    };
  }, [scope, readBaseline]);
  useEffect(() => {
    if (dirty || pending) return;
    setName(workspace?.name ?? "");
    setAvatarKey(workspace?.avatarKey ?? "");
    setSaved(workspace);
  }, [workspace]);
  const ready = baseline?.scope === scope;
  async function save() {
    if (
      !canManage ||
      !workspace ||
      !ready ||
      !baseline ||
      busy.current ||
      !dirty ||
      !name.trim()
    )
      return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const response = await client.request("workspace.update", {
        workspaceId: workspace.workspaceId,
        basedOnControlRoomSeq: baseline.seq,
        idempotencyKey: browserOpaqueId(),
        name: name.trim(),
        avatarKey: avatarKey || null,
        ...(avatarUploadIntentId ? { avatarUploadIntentId } : {}),
      });
      if (!isCurrent()) return;
      setName(response.workspace.name);
      setAvatarKey(response.workspace.avatarKey ?? "");
      setSaved(response.workspace);
      setIntent(undefined);
      setBaseline({ scope, seq: response.event.roomSeq });
      onUpdated(response.workspace);
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  async function upload(file: File | undefined) {
    if (!file || !canManage || !ready || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      if (!client.profileImages) throw new Error("头像存储不可用");
      const result = await client.profileImages.upload(file);
      if (!isCurrent()) return;
      setAvatarKey(result.avatarKey);
      setIntent(result.uploadIntentId);
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : "头像上传失败");
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return {
    name,
    setName,
    avatarKey,
    ready,
    pending,
    error,
    dirty,
    save,
    upload,
    retry: () => {
      if (!busy.current) void readBaseline();
    },
  };
}
