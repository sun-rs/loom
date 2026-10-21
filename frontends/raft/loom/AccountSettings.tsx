import { useDraftNavigation } from "./DraftNavigation.tsx";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "raft-ui";
import { LoomAccountSection } from "./OfficialSettingsSections.generated.tsx";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, ClientPrincipalUpdateRequest } from "@rah-os/protocol";
import {
  isUploadedProfileImageKey,
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_MIME_TYPES,
} from "@rah-os/protocol";
import { ManagementClient } from "./management-client.ts";
import { useManagement } from "./ManagementUi.tsx";
import { useRouteIntentOwner } from "./useIntentRoute.ts";

const Context = createContext<ReturnType<typeof useController> | null>(null);
export function useAccountSettings() {
  const value = useContext(Context);
  if (!value) throw Error("Missing account settings owner");
  return value;
}
function useController(
  client: RahClient,
  workspaceId: string,
  controlRoomId: string,
) {
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [base, setBase] = useState<Principal>();
  const [displayName, setName] = useState(""),
    [saved, setSaved] = useState(false),
    [notice, setNotice] = useState("");
  const [reading, setReading] = useState(false),
    [needsRead, setNeedsRead] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  useDraftNavigation(
    Boolean(base && displayName !== (base.displayName ?? base.handle)),
    () => {
      if (base) setName(base.displayName ?? base.handle);
    },
  );
  const readingRef = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request("principal.me", {}, { signal: abort.signal })
      .then(({ principal }) => {
        if (abort.signal.aborted) return;
        setBase(principal);
        setName(principal.displayName ?? principal.handle);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("无法读取个人资料，请重新读取。");
      });
    return () => {
      abort.abort();
      clearTimeout(timer.current);
    };
  }, [client, setError]);
  const busy = state !== "idle" || reading;
  const submit = async (file?: File) => {
    if (
      !base ||
      manager.writes.state !== "idle" ||
      readingRef.current ||
      needsRead
    )
      return;
    const name = file ? (base.displayName ?? base.handle) : displayName.trim();
    if (!name || name.length > 120) return;
    if (
      file &&
      (!PROFILE_IMAGE_MIME_TYPES.includes(
        file.type as (typeof PROFILE_IMAGE_MIME_TYPES)[number],
      ) ||
        file.size > PROFILE_IMAGE_MAX_BYTES ||
        file.size === 0)
    ) {
      setAvatarError("请选择不超过 5 MB 的 PNG、JPEG、GIF 或 WebP 图片。");
      return;
    }
    if (file && !client.profileImages) {
      setAvatarError("当前客户端不支持头像上传。");
      return;
    }
    setError("");
    setAvatarError("");
    setNotice("");
    setSaved(false);
    clearTimeout(timer.current);
    const payload: ClientPrincipalUpdateRequest = {
      displayName: name,
      avatarKey: base.avatarKey ?? null,
      description: base.description ?? null,
      expectedProfile: {
        displayName: base.displayName ?? null,
        avatarKey: base.avatarKey ?? null,
        description: base.description ?? null,
      },
    };
    try {
      await manager.writes.submitRevisioned({
        action: "account-profile",
        payload,
        send: async (p) => {
          const upload = file
            ? await client.profileImages!.upload(file)
            : undefined;
          return client.request("principal.update", {
            ...p,
            ...(upload
              ? {
                  avatarKey: upload.avatarKey,
                  avatarUploadIntentId: upload.uploadIntentId,
                }
              : {}),
          });
        },
        onSettled: (outcome) => {
          if (outcome.kind === "ok") {
            setBase(outcome.result.principal);
            if (!file)
              setName(
                outcome.result.principal.displayName ??
                  outcome.result.principal.handle,
              );
            setSaved(true);
            timer.current = setTimeout(() => setSaved(false), 2000);
          } else if (outcome.kind === "rejected") {
            setNeedsRead(true);
            setError("资料未保存，请读取当前资料后再修改。");
          }
        },
      });
    } catch {
      setError("无法保存个人资料，请读取当前资料后再修改。");
      setNeedsRead(true);
    }
  };
  return {
    manager,
    state,
    error,
    notice,
    reading,
    needsRead,
    user: base
      ? {
          name: base.handle,
          displayName: base.displayName ?? base.handle,
          avatarUrl: isUploadedProfileImageKey(base.avatarKey)
            ? client.profileImages?.url(base.avatarKey!)
            : undefined,
        }
      : undefined,
    displayName,
    saved,
    saving: busy,
    editingDisabled: busy || needsRead,
    avatarSaving: busy,
    avatarError,
    profileDirty:
      !needsRead &&
      Boolean(base) &&
      displayName.trim().length > 0 &&
      displayName.trim() !== (base?.displayName ?? base?.handle),
    handleDisplayNameChange(e: ChangeEvent<HTMLInputElement>) {
      setName(e.target.value);
      setSaved(false);
      setNotice("");
    },
    handleSaveProfile(e: FormEvent) {
      e.preventDefault();
      return submit();
    },
    handleUploadAvatar(file: File) {
      return submit(file);
    },
    async readCurrent() {
      if (manager.writes.state === "pending" || readingRef.current) return;
      readingRef.current = true;
      setReading(true);
      setNotice("");
      try {
        const { principal } = await client.request("principal.me", {});
        // Explicitly abandon the unverified write; readback is current state, not proof of who wrote it.
        if (manager.writes.state === "unknown") manager.writes.abandon();
        setBase(principal);
        setName(principal.displayName ?? principal.handle);
        setNeedsRead(false);
        setError("");
        setAvatarError("");
        setSaved(false);
        setNotice("已读取当前资料；未重复提交。");
      } catch {
        setError("无法读取当前资料，请重试读取；未重复提交。");
      } finally {
        readingRef.current = false;
        setReading(false);
      }
    },
  };
}
export default function AccountSettings({
  client,
  workspaceId,
  controlRoomId,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
}) {
  const value = useController(client, workspaceId, controlRoomId);
  return (
    <Context.Provider value={value}>
      <LoomAccountSection />
      {value.state === "unknown" && (
        <p role="alert" className="mb-3 text-sm">
          未收到保存结果。读取当前资料会放弃核实本次提交，并替换表单草稿；不会再次保存或上传。
        </p>
      )}
      {!value.user && value.error && (
        <p role="alert" className="mb-3 text-sm">
          {value.error}
        </p>
      )}
      {(value.state === "unknown" ||
        value.needsRead ||
        (!value.user && value.error)) && (
        <Button
          size="sm"
          variant="outline"
          disabled={value.reading}
          onClick={() => void value.readCurrent()}
        >
          读取当前资料
        </Button>
      )}
      {value.notice && (
        <p role="status" className="text-sm">
          {value.notice}
        </p>
      )}
    </Context.Provider>
  );
}
