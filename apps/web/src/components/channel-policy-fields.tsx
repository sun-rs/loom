import type { Room } from "@rah-os/protocol";

export function ChannelPolicyFields({
  steer,
  tasks,
  disabled,
  onSteer,
  onTasks,
}: {
  steer: boolean;
  tasks: boolean;
  disabled: boolean;
  onSteer: (value: boolean) => void;
  onTasks: (value: boolean) => void;
}) {
  return (
    <section className="rah-channel-settings-preferences">
      <label>
        <span>
          <b>Steer</b>
          <small>
            允许本频道 Human 新消息在实例忙时追加；取决于 CLI 支持。
          </small>
        </span>
        <input
          type="checkbox"
          aria-label="Steer"
          checked={steer}
          disabled={disabled}
          onChange={(event) => onSteer(event.target.checked)}
        />
        <i aria-hidden="true" />
      </label>
      <label>
        <span>
          <b>允许实例自主创建任务</b>
          <small>关闭时由 Human 创建任务；不阻止实例在频道直接工作。</small>
        </span>
        <input
          type="checkbox"
          aria-label="允许实例自主创建任务"
          checked={tasks}
          disabled={disabled}
          onChange={(event) => onTasks(event.target.checked)}
        />
        <i aria-hidden="true" />
      </label>
    </section>
  );
}
export function ChannelWorkspaceView({ room }: { room: Room | undefined }) {
  return (
    <section className="rah-channel-settings-field">
      <h3>工作区（只读，创建时固定）</h3>
      <dl>
        <dt>主目录</dt>
        <dd style={{ overflowWrap: "anywhere" }}>
          {room?.channelWorkspace?.primaryDirectory ?? "旧频道未记录平台主目录"}
        </dd>
        <dt>附加目录</dt>
        {room?.channelWorkspace?.additionalDirectories.length ? (
          room.channelWorkspace.additionalDirectories.map((path) => (
            <dd key={path} style={{ overflowWrap: "anywhere" }}>
              {path}
            </dd>
          ))
        ) : (
          <dd>无</dd>
        )}
      </dl>
    </section>
  );
}
