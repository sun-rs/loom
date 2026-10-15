import DraftAttachment from "./DraftAttachment.tsx";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import {
  ComposerActions,
  ComposerIconButton,
  ComposerAttachments,
} from "raft-ui";
import { Plus, Paperclip } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import NativeInput from "../packages/web/src/components/message/MessageInput.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { FileUploadStore } from "./file-uploads.ts";
import ComputerFiles from "./ComputerFiles.tsx";
const stores = new WeakMap<RahClient, FileUploadStore>();
function storeFor(client: RahClient) {
  let store = stores.get(client);
  if (!store) {
    store = new FileUploadStore(client);
    stores.set(client, store);
  }
  return store;
}
const Context = createContext<{
  client: RahClient;
  disabled: boolean;
  add: (files: FileList | null) => void;
} | null>(null);
type Props = Omit<ComponentProps<typeof NativeInput>, "onSendOverride"> & {
  client: RahClient;
  roomId: string;
  onSendOverride: (
    body: string,
    mentions?: unknown,
    asTask?: boolean,
    attachmentIds?: string[],
  ) => Promise<void>;
};
export default function ComposerFiles({
  client,
  roomId,
  onSendOverride,
  ...props
}: Props) {
  const store = useMemo(() => storeFor(client), [client]);
  const rows = useSyncExternalStore(store.subscribe, () =>
    store.read(props.channelId),
  );
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const disabled = !!props.submitDisabled || sending;
  const add = (files: FileList | null) => {
    if (disabled || !files) return;
    setError("");
    for (const file of Array.from(files))
      void store
        .add(props.channelId, roomId, file)
        .catch((e) => setError(String(e)));
  };
  const blocked = rows.some((row) => row.status !== "ready");
  return (
    <Context.Provider value={{ client, disabled, add }}>
      <div
        className="contents"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
          }
        }}
        onDropCapture={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            e.stopPropagation();
            add(e.dataTransfer.files);
          }
        }}
        onPasteCapture={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            e.stopPropagation();
            add(e.clipboardData.files);
          }
        }}
      >
        <NativeInput
          {...props}
          showTaskButton={props.showTaskButton}
          allowEmptySubmit={rows.length > 0 && !blocked}
          submitDisabled={disabled || blocked}
          accessoryRow={
            <>
              {props.accessoryRow}
              {error && <p role="alert">{error}</p>}
              {!!rows.length && (
                <ComposerAttachments data-testid="loom-attachment-drafts">
                  {rows.map((row) => (
                    <DraftAttachment
                      key={row.id}
                      row={row}
                      disabled={disabled}
                      remove={() => store.remove(props.channelId, row.id)}
                    />
                  ))}
                </ComposerAttachments>
              )}
            </>
          }
          onSendOverride={async (body, mentions, asTask?: boolean) => {
            if (disabled || blocked) throw Error("附件尚未就绪");
            const snapshot = [...store.read(props.channelId)];
            if (asTask && snapshot.length)
              throw Error("任务创建不支持附件，请先发送消息");
            setSending(true);
            try {
              await onSendOverride(
                body,
                mentions,
                asTask,
                snapshot.map((row) => row.attachmentId!),
              );
              store.accept(
                props.channelId,
                snapshot.map((row) => row.id),
              );
            } finally {
              setSending(false);
            }
          }}
        />
      </div>
    </Context.Provider>
  );
}
export function ComposerFilesTools({
  insert,
  taskMode,
}: {
  insert: (text: string) => void;
  taskMode: boolean;
}) {
  const context = useContext(Context),
    [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null),
    triggerRef = useRef<HTMLButtonElement>(null);
  if (!context) return null;
  const { disabled, client } = context;
  return (
    <ComposerActions>
      <Tooltip content="引用计算机文件或文件夹">
        <ComposerIconButton
          ref={triggerRef}
          disabled={disabled}
          aria-label="引用计算机文件或文件夹"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
        >
          <Plus size={14} />
        </ComposerIconButton>
      </Tooltip>
      <span className="relative isolate inline-flex">
        <ComposerIconButton
          disabled={disabled || taskMode}
          aria-label="上传文件或图片"
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip size={14} />
        </ComposerIconButton>
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="上传文件或图片"
          data-testid="loom-native-file-input"
          disabled={disabled || taskMode}
          className="absolute inset-0 z-20 size-full cursor-pointer opacity-0"
          onChange={(e) => {
            if (!taskMode) context.add(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
      </span>
      {open && (
        <ComputerFiles
          client={client}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          onSelect={(paths) => {
            if (!disabled)
              insert(paths.map((p) => "@" + JSON.stringify(p)).join(" ") + " ");
            setOpen(false);
          }}
        />
      )}
    </ComposerActions>
  );
}
