import { useState } from "react";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
export type SearchDestination = {
  key: string;
  title: string;
  subtitle: string;
  badge: string;
  roomId?: string;
  principalId?: string;
  kind: "channel" | "agent" | "human";
  privateChannel?: boolean;
  archived?: boolean;
  searchText?: string;
  avatarKey?: string;
};
export function SearchDestinationCard({
  entry,
  onOpen,
  common = false,
}: {
  entry: SearchDestination;
  onOpen: (entry: SearchDestination) => void;
  common?: boolean;
}) {
  return (
    <button
      type="button"
      className={common ? "rah-search-common" : "rah-search-destination"}
      data-archived={entry.archived || undefined}
      onClick={() => onOpen(entry)}
    >
      {entry.kind === "channel" ? (
        <span className="rah-search-channel-icon">
          <Icon name={entry.privateChannel ? "lock" : "hash"} />
        </span>
      ) : (
        <ProfileImageAvatar
          name={entry.title}
          kind={entry.kind}
          avatarKey={entry.avatarKey}
          {...(entry.principalId ? { principalId: entry.principalId } : {})}
          size="sidebar"
        />
      )}
      <span className="rah-search-card-copy">
        <span className="rah-search-card-name">
          <b>{entry.title}</b>
          {!common && <small>{entry.badge}</small>}
          {entry.archived && (
            <small className="rah-search-archived-badge">已归档</small>
          )}
        </span>
        <span className="rah-search-card-subtitle">{entry.subtitle}</span>
      </span>
    </button>
  );
}
export function SearchSuggestions({
  frequent,
  history,
  onClear,
  onSelect,
  onOpen,
  onRemove,
}: {
  frequent: readonly SearchDestination[];
  history: readonly string[];
  onClear: () => void;
  onSelect: (value: string) => void;
  onOpen: (entry: SearchDestination) => void;
  onRemove: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section
      className="rah-search-suggestions"
      aria-label="搜索建议"
      data-editing={editing}
    >
      {history.length > 0 && (
        <section className="rah-search-history-section">
          <header>
            <h2>
              <Icon name="clock-3" />
              搜索历史
            </h2>
            <span className="rah-search-history-actions">
              <button
                className="rah-search-history-edit rah-interaction-flat"
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? "完成" : "编辑"}
              </button>
              <button
                className="rah-search-clear rah-interaction-flat"
                onClick={() => {
                  setEditing(false);
                  onClear();
                }}
              >
                清除
              </button>
            </span>
          </header>
          <div className="rah-search-history-tags">
            {history.map((value) => (
              <span className="rah-search-history-tag" key={value}>
                <button
                  className="rah-search-suggestion rah-interaction-flat"
                  onClick={() => onSelect(value)}
                >
                  <Icon name="clock-3" />
                  {value}
                </button>
                <button
                  className="rah-search-history-remove"
                  aria-label={`从搜索历史中移除“${value}”`}
                  onClick={() => onRemove(value)}
                >
                  <Icon name="x" />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
      <section className="rah-search-common-section">
        <header>
          <h2>
            <Icon name="star" />
            常用
          </h2>
        </header>
        {frequent.length ? (
          <div className="rah-search-common-grid">
            {frequent.map((entry) => (
              <SearchDestinationCard
                key={entry.key}
                entry={entry}
                onOpen={onOpen}
                common
              />
            ))}
          </div>
        ) : (
          <p className="rah-search-common-empty">
            你从搜索中打开过的频道和联系人会显示在这里。
          </p>
        )}
      </section>
    </section>
  );
}
