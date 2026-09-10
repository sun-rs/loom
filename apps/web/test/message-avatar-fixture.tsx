import React from "react";
import { createRoot } from "react-dom/client";
import "../src/product-styles.ts";
import { HumanIdentity } from "../src/components/human-identity.tsx";
import { ProfileImageAvatar } from "../src/components/profile-image-avatar.tsx";

createRoot(document.getElementById("root")!).render(
  <>
    <article className="msg" data-testid="human-message">
      <HumanIdentity
        principal={{
          principalId: "fixture-human",
          kind: "human",
          handle: "owner",
        }}
        avatar
        className="rah-message-avatar-trigger"
      />
      <div>Fixture Human message</div>
    </article>
    <article className="msg" data-testid="agent-message">
      <span className="rah-message-avatar-trigger">
        <ProfileImageAvatar
          avatarKey={undefined}
          kind="agent"
          name="Agent"
          size="sidebar"
        />
      </span>
      <div>Fixture Agent message</div>
    </article>
    <div data-testid="sidebar-human">
      <ProfileImageAvatar avatarKey={undefined} name="Owner" size="sidebar" />
    </div>
  </>,
);
