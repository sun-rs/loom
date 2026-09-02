import { useEffect, useState } from "react";

import type {
  InputRequest,
  NavigationTarget,
  Room,
  SystemNotification,
} from "@rah-os/protocol";

import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "./icon.tsx";

export function HumanInboxCenter({
  error,
  loading,
  onClose,
  onOpenRoom,
  onResolve,
  requests,
  rooms,
  systemNotices = [],
  onDismissSystem,
  onOpenSystem,
}: {
  error: string | undefined;
  loading: boolean;
  onClose: () => void;
  onOpenRoom: (roomId: string) => void;
  onResolve: (request: InputRequest, answer: string) => Promise<void>;
  requests: readonly InputRequest[];
  rooms: readonly Room[];
  systemNotices?: readonly SystemNotification[];
  onDismissSystem?: (id: string) => Promise<void> | void;
  onOpenSystem?: (target: NavigationTarget) => Promise<void> | void;
}) {
  const [answering, setAnswering] = useState<InputRequest>();
  const dialogRef = useDialogProtocol({
    blocked: answering !== undefined,
    initialFocus: "container",
    onClose,
  });
  useEffect(() => {
    if (
      answering !== undefined &&
      !requests.some(
        (request) =>
          request.inputRequestId === answering.inputRequestId &&
          request.state === "pending",
      )
    ) {
      setAnswering(undefined);
    }
  }, [answering, requests]);
  return (
    <>
      <button
        aria-label="关闭通知"
        className="rah-notification-backdrop"
        onClick={onClose}
      />
      <section
        aria-label="Human Inbox"
        aria-modal="true"
        className="notification-center rah-human-inbox"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="notification-center-head">
          <strong>通知</strong>
          <span>{requests.length + systemNotices.length} 项待处理</span>
        </header>
        <div className="notification-center-scroll">
          {systemNotices.length > 0 && (
            <div className="rah-human-inbox-list">
              {systemNotices.map((notice) => (
                <article key={notice.notificationId}>
                  <header>
                    <span>计算机</span>
                  </header>
                  <strong>{notice.computerName} 离线</strong>
                  <p>
                    这台 Computer 的心跳已停止。请检查该机器上的 RAH OS
                    服务；CLI 是否已安装不代表连接状态。
                  </p>
                  <footer>
                    <button
                      className="btn"
                      onClick={() => void onOpenSystem?.(notice.target)}
                    >
                      查看计算机
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        void onDismissSystem?.(notice.notificationId)
                      }
                    >
                      忽略此提醒
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          )}
          {loading ? (
            <div className="notification-empty">
              <Icon name="bell" />
              <strong>正在读取 Inbox</strong>
              <p>从 canonical InputRequest 投影加载。</p>
            </div>
          ) : error !== undefined ? (
            <div className="notification-empty is-error">
              <Icon name="bell" />
              <strong>Inbox 暂不可用</strong>
              <p>{error}</p>
            </div>
          ) : requests.length === 0 && systemNotices.length === 0 ? (
            <div className="notification-empty">
              <Icon name="check" />
              <strong>暂无通知</strong>
              <p>需要你关注的事项会显示在这里。</p>
            </div>
          ) : (
            <div className="rah-human-inbox-list">
              {requests.map((request) => {
                const room = rooms.find(
                  ({ roomId }) => roomId === request.roomId,
                );
                return (
                  <article key={request.inputRequestId}>
                    <header>
                      <span>需要输入</span>
                      <time dateTime={request.createdAt}>
                        {formatInboxTime(request.createdAt)}
                      </time>
                    </header>
                    <strong>{request.question}</strong>
                    <p>
                      #{room?.name ?? request.roomId} · Task {request.taskId}
                    </p>
                    <footer>
                      <button
                        className="btn"
                        onClick={() => onOpenRoom(request.roomId)}
                      >
                        查看 Room
                      </button>
                      <button
                        className="btn btn-pink"
                        onClick={() => setAnswering(request)}
                      >
                        回答
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
      {answering === undefined ? null : (
        <HumanInputRequestDialog
          onClose={() => setAnswering(undefined)}
          onResolve={async (answer) => {
            await onResolve(answering, answer);
            setAnswering(undefined);
          }}
          request={answering}
          room={rooms.find(({ roomId }) => roomId === answering.roomId)}
        />
      )}
    </>
  );
}

function HumanInputRequestDialog({
  onClose,
  onResolve,
  request,
  room,
}: {
  onClose: () => void;
  onResolve: (answer: string) => Promise<void>;
  request: InputRequest;
  room: Room | undefined;
}) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭回答窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-input-request-title"
        aria-modal="true"
        className="rah-dialog rah-input-request-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-input-request-title">回答 Agent</h2>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = answer.trim();
            if (value === "") return;
            setPending(true);
            setError(undefined);
            void onResolve(value)
              .catch((caught: unknown) => setError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <section className="rah-input-request-question">
            <small>#{room?.name ?? request.roomId}</small>
            <strong>{request.question}</strong>
          </section>
          <label>
            你的回答 <em>*</em>
            <textarea
              autoFocus
              data-dialog-initial-focus
              maxLength={64 * 1_024}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="输入后，等待中的 Task 会恢复并产生新的 Agent Activation。"
              rows={5}
              value={answer}
            />
          </label>
          {error === undefined ? null : (
            <p className="rah-dialog-error">{error}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="btn btn-pink"
              disabled={pending || answer.trim() === ""}
            >
              {pending ? "正在发送…" : "发送回答"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function formatInboxTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
