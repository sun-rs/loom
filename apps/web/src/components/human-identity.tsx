import { useContext, type ReactNode } from "react";
import type { Principal } from "@rah-os/protocol";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { PreviewCard } from "./preview-card.tsx";
import {
  useHumanIdentity,
  IdentityOriginContext,
  useWorkspaceEntities,
} from "./workspace-entity-context.tsx";
import { useHumanProfile } from "../human-profile-hooks.ts";

/** Candidate must come from an authorized page query; ID is the only join key. */
export function HumanIdentity({
  principal,
  children,
  className = "rah-human-identity",
  avatar = false,
}: {
  principal: Principal;
  children?: ReactNode;
  className?: string;
  avatar?: boolean;
}) {
  const context = useHumanIdentity();
  const origin = useContext(IdentityOriginContext);
  const entities = useWorkspaceEntities();
  const person = entities?.resolvePerson(principal) ?? principal;
  const name = person.displayName || person.handle;
  const contents =
    children ??
    (avatar ? (
      <ProfileImageAvatar
        avatarKey={person.avatarKey}
        principalId={person.principalId}
        name={name}
        size="sidebar"
      />
    ) : (
      <>
        <ProfileImageAvatar
          avatarKey={person.avatarKey}
          principalId={person.principalId}
          name={name}
          size="compact"
        />
        <b>{name}</b>
        <small>@{person.handle}</small>
      </>
    ));
  if (!context) return <span className={className}>{contents}</span>;
  return (
    <PreviewCard
      label={`查看 ${name} 资料`}
      triggerClassName={className}
      className="rah-human-preview"
      onClick={() => context.onOpenHuman(person.principalId, origin)}
      content={<HumanPreview principalId={person.principalId} />}
    >
      {contents}
    </PreviewCard>
  );
}
function HumanPreview({ principalId }: { principalId: string }) {
  const context = useHumanIdentity()!;
  const entities = useWorkspaceEntities();
  const { profile, error } = useHumanProfile(
    context.client,
    principalId,
    entities?.scope?.workspaceId,
  );
  if (error) return <p className="rah-profile-notice">无法读取成员资料</p>;
  if (!profile) return <p className="rah-profile-notice">正在读取成员资料…</p>;
  const human = {
    ...profile.principal,
    ...entities?.resolvePerson(profile.principal),
  };
  return (
    <>
      <div className="rah-profile-identity">
        <ProfileImageAvatar
          avatarKey={human.avatarKey}
          name={human.displayName || human.handle}
          size="profile"
        />
        <div>
          <h2>{human.displayName || human.handle}</h2>
          <p>@{human.handle}</p>
        </div>
      </div>
      {human.description && (
        <p className="rah-human-preview-description" title={human.description}>
          {human.description}
        </p>
      )}
    </>
  );
}
