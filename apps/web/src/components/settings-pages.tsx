import { useEffect, useState, type ChangeEvent } from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Workspace } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  readLiveAgentActivity,
  readMessageSize,
  writeLiveAgentActivity,
  writeMessageSize,
  type RahMessageSize,
} from "../settings-preferences.ts";
import { AgentAvatar } from "./agent-directory-pane.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { SettingsPage, SettingsSectionLabel } from "./settings-primitives.tsx";

export function AccountSettingsContent({
  client,
  onUpdated,
  principal,
}: {
  client: RahClient;
  onUpdated: (principal: Principal) => void;
  principal: Principal | undefined;
}) {
  const [displayName, setDisplayName] = useState(
    principal?.displayName ?? principal?.handle ?? "",
  );
  const [avatarKey, setAvatarKey] = useState(principal?.avatarKey ?? "");
  const [avatarUploadIntentId, setAvatarUploadIntentId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const profileDirty =
    displayName.trim() !==
      (principal?.displayName ?? principal?.handle ?? "").trim() ||
    avatarKey !== (principal?.avatarKey ?? "");
  useEffect(() => {
    setDisplayName(principal?.displayName ?? principal?.handle ?? "");
    setAvatarKey(principal?.avatarKey ?? "");
    setAvatarUploadIntentId(undefined);
  }, [principal]);
  async function save() {
    if (!principal || pending || !displayName.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await client.request("principal.update", {
        avatarKey: avatarKey || null,
        ...(avatarUploadIntentId ? { avatarUploadIntentId } : {}),
        displayName,
      });
      setAvatarUploadIntentId(undefined);
      onUpdated(result.principal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (!client.profileImages) throw new Error("头像存储不可用");
      const result = await client.profileImages.upload(file);
      setAvatarKey(result.avatarKey);
      setAvatarUploadIntentId(result.uploadIntentId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "头像上传失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsPage icon="user-round" title="账户">
      <SettingsSectionLabel>个人资料</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-form-card rah-settings-profile-editor">
        <div className="rah-settings-profile-preview">
          <AvatarUploadControl
            avatarKey={avatarKey}
            disabled={!principal || pending}
            name={displayName || principal?.handle || "本地用户"}
            onChange={(event) => void upload(event)}
          />
          <div>
            <strong>{displayName || "本地用户"}</strong>
            <p>@{principal?.handle ?? "local"}</p>
          </div>
        </div>
        <label>
          显示名称
          <input
            disabled={!principal || pending}
            maxLength={120}
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        </label>
        <div className="rah-settings-form-actions">
          <button
            className="btn pink"
            disabled={
              !principal || pending || !displayName.trim() || !profileDirty
            }
            onClick={() => void save()}
            type="button"
          >
            {pending ? "保存中…" : "保存资料"}
          </button>
        </div>
        {error ? (
          <p className="rah-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </article>
      <SettingsSectionLabel>登录方式</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-copy-card">
        <strong>RAH OS 本机授权</strong>
        <p>
          身份由当前本机 daemon 与浏览器会话验证。RAH OS 不依赖 Raft
          中央账户、第三方社交登录或付费账户体系。
        </p>
      </article>
    </SettingsPage>
  );
}

export function AppearanceSettingsContent() {
  const [messageSize, setMessageSize] = useState<RahMessageSize>(() =>
    readMessageSize(window.localStorage),
  );
  const [liveActivity, setLiveActivity] = useState(() =>
    readLiveAgentActivity(window.localStorage),
  );
  return (
    <SettingsPage icon="type" title="外观">
      <SettingsSectionLabel>消息字号</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-form-card">
        <p>只保存在此设备，并应用于聊天室和私信正文。</p>
        <div
          className="rah-settings-choice-row"
          role="group"
          aria-label="消息字号"
        >
          {(
            [
              ["small", "小"],
              ["medium", "中"],
              ["large", "大"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={messageSize === value}
              className="btn"
              key={value}
              onClick={() => {
                setMessageSize(value);
                writeMessageSize(window.localStorage, value);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div className={`rah-settings-message-preview is-${messageSize}`}>
          <AgentAvatar
            agent={{
              avatarKey: "avatar-03",
              displayName: "Cindy",
              runtimeAvailable: true,
              state: "enabled",
            }}
            size="compact"
          />
          <div>
            <div className="rah-settings-preview-meta">
              <strong>Cindy</strong> <span>00:02</span>
            </div>
            <p>
              @Joy <mark>#proj-uiux</mark> 新设计很棒 — 正在{" "}
              <code>git pull</code>
              本地试用。
            </p>
          </div>
        </div>
      </article>
      <SettingsSectionLabel>实时 Agent 活动</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-toggle-card">
        <div>
          <strong>显示实时 Agent 状态</strong>
          <p>
            保留持久化动态记录；关闭后隐藏本设备 Room
            列表底部的瞬态工作条，并停止实时状态动画。
          </p>
        </div>
        <label className="rah-settings-switch">
          <input
            checked={liveActivity}
            onChange={(event) => {
              setLiveActivity(event.target.checked);
              writeLiveAgentActivity(window.localStorage, event.target.checked);
            }}
            type="checkbox"
          />
          <span aria-hidden="true" />
        </label>
      </article>
    </SettingsPage>
  );
}

export function WorkspaceProfileSettingsContent({
  canManage,
  client,
  onUpdated,
  workspace,
}: {
  canManage: boolean;
  client: RahClient;
  onUpdated: (workspace: Workspace) => void;
  workspace: Workspace | undefined;
}) {
  const [name, setName] = useState(workspace?.name ?? "");
  const [avatarKey, setAvatarKey] = useState(workspace?.avatarKey ?? "");
  const [avatarUploadIntentId, setAvatarUploadIntentId] = useState<string>();
  const [baseline, setBaseline] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setName(workspace?.name ?? "");
    setAvatarKey(workspace?.avatarKey ?? "");
    setAvatarUploadIntentId(undefined);
    if (!workspace?.controlRoomId) return;
    const controller = new AbortController();
    void client
      .request(
        "room.sync",
        {
          afterSeq: 0,
          consumerId: `settings-profile-${workspace.workspaceId}`,
          limit: 1,
          roomId: workspace.controlRoomId,
        },
        { signal: controller.signal },
      )
      .then((result) => {
        if (!controller.signal.aborted) setBaseline(result.latestRoomSeq);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : "无法读取空间版本",
          );
      });
    return () => controller.abort();
  }, [client, workspace]);
  async function save() {
    if (!workspace?.controlRoomId || baseline === undefined || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await client.request("workspace.update", {
        avatarKey: avatarKey || null,
        ...(avatarUploadIntentId ? { avatarUploadIntentId } : {}),
        basedOnControlRoomSeq: baseline,
        idempotencyKey: crypto.randomUUID(),
        name,
        workspaceId: workspace.workspaceId,
      });
      onUpdated(response.workspace);
      setAvatarUploadIntentId(undefined);
      setBaseline((value) => (value === undefined ? value : value + 1));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (!client.profileImages) throw new Error("头像存储不可用");
      const result = await client.profileImages.upload(file);
      setAvatarKey(result.avatarKey);
      setAvatarUploadIntentId(result.uploadIntentId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "头像上传失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsPage icon="server" title="服务器资料">
      <SettingsSectionLabel>资料</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-form-card">
        <div className="rah-settings-profile-preview">
          <AvatarUploadControl
            avatarKey={avatarKey}
            disabled={!canManage || pending || baseline === undefined}
            name={name || workspace?.name || "本地协作空间"}
            onChange={(event) => void upload(event)}
          />
          <div>
            <strong>{name || workspace?.name || "本地协作空间"}</strong>
            <p>/{workspace?.slug ?? "local"}</p>
          </div>
        </div>
        <label>
          名称
          <input
            disabled={!canManage || pending || baseline === undefined}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label>
          短名 (slug)
          <input readOnly value={workspace?.slug ?? ""} />
        </label>
        <div className="rah-settings-form-actions">
          <button
            className="btn pink"
            disabled={
              !canManage || pending || !name.trim() || baseline === undefined
            }
            onClick={() => void save()}
            type="button"
          >
            {pending ? "保存中…" : "保存资料"}
          </button>
        </div>
        {error ? (
          <p className="rah-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </article>
      <p className="rah-settings-footnote">
        本地版服务器即当前协作空间；它由本机 daemon 承载，不依赖 Raft
        中央服务器。
      </p>
    </SettingsPage>
  );
}

export function AdministrationSettingsContent({
  agents,
  principal,
}: {
  agents: readonly WorkspaceAgentView[];
  principal: Principal | undefined;
}) {
  return (
    <SettingsPage icon="shield-check" title="管理">
      <SettingsSectionLabel>所有者和管理员</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-member-row">
        <div className="rah-settings-avatar" aria-hidden="true">
          {(principal?.displayName ?? principal?.handle ?? "H")
            .slice(0, 1)
            .toUpperCase()}
        </div>
        <div>
          <strong>
            {principal?.displayName ?? principal?.handle ?? "本地用户"}
          </strong>
          <p>当前本机 Human</p>
        </div>
        <span className="role-owner">所有者</span>
      </article>
      <SettingsSectionLabel>Agent</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-copy-card">
        <strong>{agents.length} 个工作空间 Agent</strong>
        <p>
          Agent 角色、模型、effort 与运行模式由 Agent 资料页管理；Room
          成员角色由成员页管理。 这里不伪造 Raft
          中央邀请链接、社交账户或跨组织权限。
        </p>
      </article>
    </SettingsPage>
  );
}

function AvatarUploadControl({
  avatarKey,
  disabled,
  name,
  onChange,
}: {
  avatarKey: string | undefined;
  disabled: boolean;
  name: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      aria-label="上传图片"
      className="rah-settings-avatar-upload"
      data-disabled={disabled}
      title="上传图片"
    >
      <ProfileImageAvatar avatarKey={avatarKey} name={name} size="profile" />
      <span className="rah-settings-avatar-upload-overlay" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 3v12" />
          <path d="m17 8-5-5-5 5" />
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        </svg>
      </span>
      <input
        accept="image/jpeg,image/png,image/gif,image/webp"
        disabled={disabled}
        onChange={onChange}
        type="file"
      />
    </label>
  );
}

export function AboutSettingsContent({
  workspace,
}: {
  workspace: Workspace | undefined;
}) {
  return (
    <SettingsPage icon="info" title="关于">
      <SettingsSectionLabel>版本</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-copy-card">
        <strong>RAH OS 0.0.0</strong>
        <p>local-first 多 Agent 聊天室与任务工作台</p>
      </article>
      <SettingsSectionLabel>移动端</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-copy-card">
        <strong>PWA</strong>
        <p>
          通过受信任 HTTPS 局域网地址打开后，可添加到 iPhone/iPad
          主屏幕并接收通知。
        </p>
      </article>
      <SettingsSectionLabel>工作空间</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-copy-card">
        <strong>{workspace?.name ?? "正在读取"}</strong>
        <p>{workspace?.slug ? `/${workspace.slug}` : "本地工作空间"}</p>
      </article>
    </SettingsPage>
  );
}

export function DocsSettingsContent() {
  return (
    <SettingsPage icon="book-open" title="文档">
      <SettingsSectionLabel>产品文档</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-copy-card">
        <strong>本地 daemon / Web / PWA</strong>
        <p>
          项目内的 docs/README.md 是文档入口，包含本机部署、局域网访问、Agent
          CLI 管理、通知与安全边界。
        </p>
      </article>
    </SettingsPage>
  );
}

export function FeedbackSettingsContent() {
  const [copied, setCopied] = useState(false);
  return (
    <SettingsPage icon="message-square" title="反馈">
      <SettingsSectionLabel>诊断反馈</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-toggle-card">
        <div>
          <strong>复制本地诊断入口</strong>
          <p>不会把数据发送到 Raft 或任何中央服务。</p>
        </div>
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard
              .writeText(`${window.location.origin}/_rah/health`)
              .then(() => setCopied(true));
          }}
          type="button"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </article>
    </SettingsPage>
  );
}

export function ReleaseNotesSettingsContent() {
  return (
    <SettingsPage icon="list" title="更新日志">
      <article className="rah-settings-release">
        <time>2026-09-01</time>
        <h2>设置页行为合同收口</h2>
        <ul>
          <li>统一 Raft 设置侧栏、页头、卡片、按钮与选中态。</li>
          <li>通知、工作空间资料与本地设备偏好继续映射到本机 daemon。</li>
          <li>剔除套餐账单与中央应用商店。</li>
        </ul>
      </article>
    </SettingsPage>
  );
}
