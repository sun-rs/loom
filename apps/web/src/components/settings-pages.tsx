import { useEffect, useState, useRef, useMemo, type ChangeEvent } from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Workspace, MembershipRole } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  readLiveAgentActivity,
  readMessageSize,
  readTimeFormat,
  writeLiveAgentActivity,
  writeMessageSize,
  writeTimeFormat,
  type RahMessageSize,
  type RahTimeFormat,
} from "../settings-preferences.ts";
import { AgentAvatar } from "./agent-avatar.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { SettingsPage, SettingsSectionLabel } from "./settings-primitives.tsx";
import { useWorkspaceProfileEdit } from "../workspace-profile-edit.ts";
import { MessageMarkdown } from "./message-markdown.tsx";
import { useHumanProfileMutation } from "../human-profile-hooks.ts";

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
  const [uploading, setUploading] = useState(false);
  const [baseline, setBaseline] = useState(principal);
  const mutation = useHumanProfileMutation(client, principal, onUpdated);
  const pending = uploading || mutation.pending;
  const scope = useMemo(() => ({}), [client, principal?.principalId]);
  const uploadScope = useRef<object | undefined>(scope);
  const draftScope = useRef(scope);
  uploadScope.current = scope;
  const [error, setError] = useState<string>();
  useEffect(() => {
    uploadScope.current = scope;
    setUploading(false);
    setError(undefined);
    return () => {
      uploadScope.current = undefined;
    };
  }, [scope]);
  const profileDirty =
    displayName.trim() !==
      (baseline?.displayName ?? baseline?.handle ?? "").trim() ||
    avatarKey !== (baseline?.avatarKey ?? "");
  useEffect(() => {
    if (
      draftScope.current === scope &&
      principal?.principalId === baseline?.principalId &&
      profileDirty
    )
      return;
    draftScope.current = scope;
    setDisplayName(principal?.displayName ?? principal?.handle ?? "");
    setAvatarKey(principal?.avatarKey ?? "");
    setAvatarUploadIntentId(undefined);
    setBaseline(principal);
  }, [principal, baseline, profileDirty, scope]);
  async function save() {
    if (!principal || pending || !displayName.trim() || !profileDirty) return;
    const current = () => uploadScope.current === scope;
    setError(undefined);
    try {
      const saved = await mutation.save(
        {
          avatarKey: avatarKey || null,
          ...(avatarUploadIntentId ? { avatarUploadIntentId } : {}),
          displayName: displayName.trim(),
        },
        baseline,
      );
      if (!current()) return;
      setDisplayName(saved.displayName ?? saved.handle);
      setAvatarKey(saved.avatarKey ?? "");
      setAvatarUploadIntentId(undefined);
      setBaseline(saved);
    } catch (caught) {
      if (current())
        setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || pending) return;
    setUploading(true);
    const current = () => uploadScope.current === scope;
    setError(undefined);
    try {
      if (!client.profileImages) throw new Error("头像存储不可用");
      const result = await client.profileImages.upload(file);
      if (!current()) return;
      setAvatarKey(result.avatarKey);
      setAvatarUploadIntentId(result.uploadIntentId);
    } catch (caught) {
      if (current())
        setError(caught instanceof Error ? caught.message : "头像上传失败");
    } finally {
      if (current()) setUploading(false);
    }
  }
  return (
    <SettingsPage icon="user-round" title="账户">
      <SettingsSectionLabel>个人资料</SettingsSectionLabel>
      <form
        className="rah-settings-card rah-settings-form-card rah-settings-profile-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
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
            type="submit"
          >
            {pending ? "保存中…" : "保存资料"}
          </button>
        </div>
        {error ? (
          <p className="rah-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
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

export function LanguageRegionSettingsContent() {
  const [savedTimeFormat, setSavedTimeFormat] = useState<RahTimeFormat>(() =>
    readTimeFormat(window.localStorage),
  );
  const [timeFormat, setTimeFormat] = useState<RahTimeFormat>(savedTimeFormat);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <SettingsPage icon="languages" title="语言与区域">
      <SettingsSectionLabel icon="languages">语言</SettingsSectionLabel>
      <form
        className="rah-settings-card rah-settings-form-card"
        onSubmit={(event) => event.preventDefault()}
      >
        <div>
          <strong>显示语言</strong>
          <p>选择应用界面的显示语言。这与消息翻译无关。</p>
        </div>
        <div className="rah-settings-compact-control">
          <select
            aria-describedby="rah-display-language-note"
            aria-label="显示语言"
            disabled
          >
            <option value="zh-CN">简体中文</option>
          </select>
        </div>
        <p className="rah-settings-saved" id="rah-display-language-note">
          RAH OS 当前界面仅提供简体中文。
        </p>
        <fieldset className="rah-settings-choice-row">
          <legend>消息翻译</legend>
          <label className="rah-settings-choice">
            <input disabled name="translation-mode" type="radio" />
            <span>自动</span>
          </label>
          <label className="rah-settings-choice">
            <input disabled name="translation-mode" type="radio" />
            <span>手动</span>
          </label>
          <label className="rah-settings-choice">
            <input checked name="translation-mode" readOnly type="radio" />
            <span>关闭</span>
          </label>
        </fieldset>
        <p className="rah-settings-saved">
          本地 daemon
          尚未接入消息翻译；关闭以外的模式不可选择，也不会伪造翻译结果。
        </p>
        <div className="rah-settings-form-actions">
          <button className="btn pink" disabled type="submit">
            保存
          </button>
        </div>
      </form>

      <SettingsSectionLabel icon="clock-3">日期与时间</SettingsSectionLabel>
      <form
        className="rah-settings-card rah-settings-form-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (timeFormat === savedTimeFormat) return;
          const saved = writeTimeFormat(window.localStorage, timeFormat);
          if (saved) setSavedTimeFormat(timeFormat);
          setSaveState(saved ? "saved" : "error");
        }}
      >
        <label className="rah-settings-compact-control">
          时区
          <select aria-describedby="rah-timezone-note" disabled>
            <option value={timezone}>{timezone}</option>
          </select>
        </label>
        <p className="rah-settings-saved" id="rah-timezone-note">
          使用此设备的系统时区；Reminder 的目标时间继续由 daemon 规范化。
        </p>
        <fieldset className="rah-settings-choice-row">
          <legend>时间格式</legend>
          {(
            [
              ["12", "12 小时制"],
              ["24", "24 小时制"],
            ] as const
          ).map(([value, label]) => (
            <label className="rah-settings-choice" key={value}>
              <input
                checked={timeFormat === value}
                name="time-format"
                onChange={() => {
                  setTimeFormat(value);
                  setSaveState("idle");
                }}
                type="radio"
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <div className="rah-settings-form-actions">
          <button
            aria-label="保存日期与时间"
            className="btn pink"
            disabled={timeFormat === savedTimeFormat}
            type="submit"
          >
            保存
          </button>
        </div>
        {saveState !== "idle" ? (
          <p
            className={
              saveState === "saved" ? "rah-settings-saved" : "rah-inline-error"
            }
            role={saveState === "saved" ? "status" : "alert"}
          >
            {saveState === "saved"
              ? "已保存到此设备。"
              : "仅本次生效，无法保存到此设备。"}
          </p>
        ) : null}
      </form>
    </SettingsPage>
  );
}

export function AppearanceSettingsContent() {
  const [storageError, setStorageError] = useState(false);
  const [activityStorageError, setActivityStorageError] = useState(false);
  const [messageSize, setMessageSize] = useState<RahMessageSize>(() =>
    readMessageSize(window.localStorage),
  );
  const [liveActivity, setLiveActivity] = useState(() =>
    readLiveAgentActivity(window.localStorage),
  );
  return (
    <SettingsPage icon="type" title="外观">
      <SettingsSectionLabel icon="type">外观</SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-form-card">
        <div>
          <strong>消息字号</strong>
          <p>
            调整此设备上渲染的消息文本，包括标题、代码块、内联代码和引用标签。按钮、标签和侧栏保持其固定的界面尺寸。
          </p>
        </div>
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
                setStorageError(!writeMessageSize(window.localStorage, value));
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="rah-settings-saved">
          {storageError ? "仅本次生效，无法保存到此设备。" : "已保存到此设备。"}
        </p>
        <div>
          <p className="rah-settings-preview-label">预览</p>
          <div
            inert
            className={`rah-settings-message-preview is-${messageSize}`}
          >
            <AgentAvatar
              agent={{
                avatarKey: "avatar-03",
                displayName: "Cindy",
                runtimeAvailable: true,
                state: "enabled",
              }}
              showStatus={false}
              size="header"
            />
            <div>
              <div className="rah-settings-preview-meta">
                <strong>Cindy</strong> <span>00:02</span>
              </div>
              <div className="msg-body">
                <MessageMarkdown
                  source="@Joy #proj-uiux 新设计很棒 — 正在 `git pull` 本地试用。"
                  references={{
                    agents: [],
                    principals: [
                      {
                        principalId: "appearance-preview-human",
                        kind: "human",
                        handle: "Joy",
                      },
                    ],
                    rooms: [
                      {
                        roomId: "appearance-preview-room",
                        kind: "channel",
                        names: ["proj-uiux"],
                      },
                    ],
                    tasks: [],
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </article>
      <article className="rah-settings-card rah-settings-toggle-card">
        <div>
          <strong id="rah-live-activity-label">实时 Agent 动态</strong>
          <p>
            保留持久化动态记录；关闭后隐藏本设备 Room
            列表底部的瞬态工作条，并停止实时状态动画。
          </p>
          <p className="rah-settings-saved">
            {activityStorageError
              ? "仅本次生效，无法保存到此设备。"
              : "已保存到此设备。"}
          </p>
        </div>
        <label className="rah-settings-switch">
          <input
            aria-labelledby="rah-live-activity-label"
            checked={liveActivity}
            onChange={(event) => {
              setLiveActivity(event.target.checked);
              setActivityStorageError(
                !writeLiveAgentActivity(
                  window.localStorage,
                  event.target.checked,
                ),
              );
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
  const {
    name,
    setName,
    avatarKey,
    ready,
    pending,
    error,
    dirty,
    save,
    upload,
    retry,
  } = useWorkspaceProfileEdit(client, workspace, canManage, onUpdated);
  return (
    <SettingsPage icon="server" title="服务器资料">
      <SettingsSectionLabel icon="server">资料</SettingsSectionLabel>
      <form
        className="rah-settings-card rah-settings-form-card"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="rah-settings-profile-preview">
          <AvatarUploadControl
            avatarKey={avatarKey}
            disabled={!canManage || pending || !ready}
            name={name || workspace?.name || "本地协作空间"}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void upload(file);
            }}
          />
          <div>
            <strong>{name || workspace?.name || "本地协作空间"}</strong>
            <p>/{workspace?.slug ?? "local"}</p>
          </div>
        </div>
        <label>
          名称
          <input
            disabled={!canManage || pending || !ready}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label>
          短名 (slug)
          <span className="rah-settings-readonly-field">
            <span aria-hidden="true">/</span>
            <input readOnly tabIndex={-1} value={workspace?.slug ?? ""} />
          </span>
        </label>
        <div className="rah-settings-form-actions">
          <button
            className="btn pink"
            disabled={!canManage || pending || !name.trim() || !ready || !dirty}
            type="submit"
          >
            {pending ? "保存中…" : "保存资料"}
          </button>
        </div>
        {error ? (
          <p className="rah-inline-error" role="alert">
            {error}
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={retry}
            >
              读取最新版本后重试
            </button>
          </p>
        ) : null}
      </form>
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
  membershipRole,
}: {
  membershipRole?: MembershipRole | undefined;
  agents: readonly WorkspaceAgentView[];
  principal: Principal | undefined;
}) {
  return (
    <SettingsPage icon="shield-check" title="管理">
      <SettingsSectionLabel icon="shield-check">
        当前成员权限
      </SettingsSectionLabel>
      <article className="rah-settings-card rah-settings-member-row">
        <ProfileImageAvatar
          avatarKey={principal?.avatarKey}
          name={principal?.displayName ?? principal?.handle ?? "本地用户"}
          size="compact"
        />
        <div>
          <strong>
            {principal?.displayName ?? principal?.handle ?? "本地用户"}
          </strong>
          <p>当前本机 Human</p>
        </div>
        <span className={`role-${membershipRole ?? "unknown"}`}>
          {membershipRole === "owner"
            ? "所有者"
            : membershipRole === "admin"
              ? "管理员"
              : membershipRole === "member"
                ? "成员"
                : "权限未读取"}
        </span>
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
        <a href="/help/local-workbench.html" target="_blank" rel="noreferrer">
          打开本机操作指南
        </a>
      </article>
    </SettingsPage>
  );
}

export function FeedbackSettingsContent() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
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
            setError(false);
            setCopied(false);
            void Promise.resolve()
              .then(() =>
                navigator.clipboard.writeText(
                  `${window.location.origin}/_rah/health`,
                ),
              )
              .then(() => setCopied(true))
              .catch(() => setError(true));
          }}
          type="button"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </article>
      {error && (
        <p role="alert">
          无法写入剪贴板，请重试或手动复制：{window.location.origin}/_rah/health
        </p>
      )}
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
