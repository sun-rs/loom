import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { opaqueIdFromBytes } from "@rah-os/ui-web";
import type { RahClient } from "@rah-os/client-sdk";
import type { Room, Workspace } from "@rah-os/protocol";
import avatarPack from "@rah-os/ui-tokens/avatar-pack.json";
import {
  workspaceInitial,
  mobileWorkspaceLabel,
} from "../identity-presentation.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import {
  moveWorkspaceOrder,
  readWorkspaceOrder,
  resolveWorkspaceLocation,
  writeWorkspaceOrder,
} from "../workspace-switcher-state.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";

export function WorkspaceIdentity({
  computerName,
  workspace,
  workspaces,
  rooms,
  client,
  canManage,
  principalId,
  onUpdated,
  onSelect,
  mobile = false,
}: {
  computerName?: string | undefined;
  workspace: Workspace | undefined;
  workspaces: readonly Workspace[];
  rooms: readonly Room[];
  client: RahClient;
  canManage: boolean;
  principalId: string;
  onUpdated: (workspace: Workspace) => void;
  onSelect: (
    workspace: Workspace,
    rememberedSearch: string | undefined,
    navigationMode: "restore" | "replace-with-home",
  ) => void;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [workspaceOrder, setWorkspaceOrder] = useState<string[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = mobile
    ? "rah-mobile-workspace-switcher"
    : "rah-workspace-switcher";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  useEffect(() => {
    setWorkspaceOrder(
      readWorkspaceOrder(window.localStorage, principalId, workspaces),
    );
  }, [principalId, workspaces]);
  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        closeMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [closeMenu, open]);
  useLayoutEffect(() => {
    if (
      open &&
      menuRef.current &&
      !menuRef.current.contains(document.activeElement)
    )
      menuRef.current.focus();
  }, [open]);
  const orderedWorkspaces = useMemo(() => {
    const byId = new Map(workspaces.map((entry) => [entry.workspaceId, entry]));
    const order =
      workspaceOrder.length === 0
        ? readWorkspaceOrder(window.localStorage, principalId, workspaces)
        : workspaceOrder;
    return order.flatMap((workspaceId) => {
      const entry = byId.get(workspaceId);
      return entry ? [entry] : [];
    });
  }, [principalId, workspaceOrder, workspaces]);
  const reorder = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (overId === undefined) return;
    const next = moveWorkspaceOrder(
      workspaceOrder,
      String(event.active.id),
      String(overId),
    );
    setWorkspaceOrder(next);
    writeWorkspaceOrder(window.localStorage, principalId, next);
  };
  const selectWorkspace = (selected: Workspace) => {
    const roomIds = new Set(
      rooms
        .filter((room) => room.workspaceId === selected.workspaceId)
        .map((room) => room.roomId),
    );
    const remembered = resolveWorkspaceLocation(
      window.localStorage,
      principalId,
      selected.workspaceId,
      roomIds,
    );
    onSelect(
      selected,
      mobile ? undefined : remembered,
      mobile ? "replace-with-home" : "restore",
    );
    closeMenu(selected.workspaceId === workspace?.workspaceId);
  };
  return (
    <div className={`rah-space-identity${mobile ? " is-mobile" : ""}`}>
      <button
        ref={triggerRef}
        className={
          mobile ? "rah-mobile-space-mark" : "rail-logo rah-space-mark"
        }
        aria-label={`切换协作空间：${workspace?.name ?? computerName ?? "加载中"}`}
        title={workspace?.name ?? computerName ?? "协作空间"}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
      >
        {mobile ? (
          <>
            <span>
              {mobileWorkspaceLabel(
                workspace?.name ?? computerName ?? "协作空间",
              )}
            </span>
            <Icon name="chevron" />
          </>
        ) : workspace?.avatarKey ? (
          <ProfileImageAvatar
            avatarKey={workspace.avatarKey}
            name={workspace.name}
            size="header"
          />
        ) : (
          workspaceInitial(computerName ?? workspace?.name ?? "")
        )}
      </button>
      {open && workspace ? (
        <div
          ref={menuRef}
          id={menuId}
          className="rah-space-switcher"
          role="menu"
          aria-label="切换协作空间"
          tabIndex={-1}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={reorder}
          >
            <div className="rah-space-switcher-list">
              {orderedWorkspaces.map((entry) => (
                <WorkspaceSwitcherRow
                  key={entry.workspaceId}
                  current={entry.workspaceId === workspace.workspaceId}
                  workspace={entry}
                  onSelect={() => selectWorkspace(entry)}
                />
              ))}
            </div>
          </DndContext>
          <div className="rah-space-switcher-divider" />
          <button
            type="button"
            role="menuitem"
            className="rah-space-switcher-action"
            onClick={() => {
              setOpen(false);
              setEditOpen(true);
            }}
          >
            <span aria-hidden="true">＋</span>
            管理当前协作空间
          </button>
        </div>
      ) : null}
      {editOpen && workspace ? (
        <WorkspaceIdentityDialog
          key={workspace.workspaceId}
          workspace={workspace}
          client={client}
          canManage={canManage}
          onClose={() => {
            setEditOpen(false);
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
          onUpdated={onUpdated}
        />
      ) : null}
    </div>
  );
}

function WorkspaceSwitcherRow({
  current,
  workspace,
  onSelect,
}: {
  current: boolean;
  workspace: Workspace;
  onSelect: () => void;
}) {
  const drag = useDraggable({ id: workspace.workspaceId });
  const drop = useDroppable({ id: workspace.workspaceId });
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      className={`rah-space-switcher-row${drag.isDragging ? " is-dragging" : ""}${drop.isOver ? " is-over" : ""}`}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={current}
        className="rah-space-switcher-select"
        onClick={onSelect}
      >
        <span
          className={`rah-space-switcher-check${current ? " is-current" : ""}`}
          aria-hidden="true"
        >
          ✓
        </span>
        <ProfileImageAvatar
          avatarKey={workspace.avatarKey}
          name={workspace.name}
          size="compact"
        />
        <span className="rah-space-switcher-copy">
          <b>{workspace.name}</b>
          <span>/{workspace.slug}</span>
        </span>
      </button>
      <button
        type="button"
        className="rah-space-switcher-drag"
        aria-label={`调整 ${workspace.name} 顺序`}
        {...drag.attributes}
        {...drag.listeners}
      >
        ⠿
      </button>
    </div>
  );
}

function WorkspaceIdentityDialog({
  workspace,
  client,
  canManage,
  onClose,
  onUpdated,
}: {
  workspace: Workspace;
  client: RahClient;
  canManage: boolean;
  onClose: () => void;
  onUpdated: (workspace: Workspace) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [avatarKey, setAvatarKey] = useState(workspace.avatarKey ?? "");
  const [pending, setPending] = useState(false);
  const [baseline, setBaseline] = useState<number>();
  const [mutationId] = useState(() =>
    opaqueIdFromBytes(crypto.getRandomValues(new Uint8Array(16))),
  );
  const [error, setError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  useEffect(() => {
    if (!workspace.controlRoomId) return;
    const controller = new AbortController();
    void client
      .request(
        "room.sync",
        {
          roomId: workspace.controlRoomId,
          consumerId: `workspace-identity-${mutationId}`,
          afterSeq: 0,
          limit: 1,
        },
        { signal: controller.signal },
      )
      .then(async (sync) => {
        const current = await client.request(
          "workspace.list",
          {},
          { signal: controller.signal },
        );
        const canonical = current.workspaces.find(
          (w) => w.workspaceId === workspace.workspaceId,
        );
        if (!controller.signal.aborted && canonical) {
          setName(canonical.name);
          setAvatarKey(canonical.avatarKey ?? "");
          setBaseline(sync.latestRoomSeq);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "无法读取空间版本");
      });
    return () => controller.abort();
  }, [client, workspace.controlRoomId, workspace.workspaceId, mutationId]);
  async function save() {
    if (
      !workspace.controlRoomId ||
      !canManage ||
      pending ||
      baseline === undefined
    )
      return;
    setPending(true);
    setError(undefined);
    try {
      // Freeze the causal baseline, never silently overwrite a concurrent edit.
      const response = await client.request("workspace.update", {
        workspaceId: workspace.workspaceId,
        name,
        avatarKey: avatarKey || null,
        basedOnControlRoomSeq: baseline,
        idempotencyKey: mutationId,
      });
      onUpdated(response.workspace);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="rah-dialog-layer">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭空间设置背景"
        disabled={pending}
        onClick={onClose}
      />
      <section
        className="rah-dialog rah-space-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="协作空间"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header>
          <h2>协作空间</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            空间名称
            <input
              aria-label="空间名称"
              required
              maxLength={120}
              value={name}
              disabled={!canManage || pending || baseline === undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            空间头像
            <select
              aria-label="空间头像"
              value={avatarKey}
              disabled={!canManage || pending || baseline === undefined}
              onChange={(e) => setAvatarKey(e.target.value)}
            >
              <option value="">名称首字母</option>
              {avatarKey && !(avatarKey in avatarPack.presets) ? (
                <option value={avatarKey}>当前上传头像</option>
              ) : null}
              {Object.keys(avatarPack.presets).map((key) => (
                <option value={key} key={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <footer>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="btn primary"
              disabled={
                !canManage || pending || baseline === undefined || !name.trim()
              }
            >
              {pending ? "保存中…" : "保存更改"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
