// GENERATED from pinned official SettingsPanel. Explicit omissions and write-fence patches are recorded in generate-settings-sections.mjs and ui-contract.json.
import type {ReactNode,FormEvent} from 'react';
import {useIntl} from 'react-intl';
import {User,Tag,Eye,Bell,Check} from 'lucide-react';
import {Card,Button,Badge,Checkbox,Input,Separator} from 'raft-ui';
import SectionHeader from '@loom/raft-web-source/SectionHeader';
import Tooltip from '@loom/raft-web-source/Tooltip';
import AvatarEditVeil from '@loom/raft-web-source/AvatarEditVeil';
import SettingsProfileCard from '../packages/web/src/components/settings/SettingsProfileCard';
import FormField from '../packages/web/src/components/ui/FormField';
import {PrefixedInput} from '../packages/web/src/components/ui/SlugInput';
import AvatarSlot from '../packages/web/src/components/ui/AvatarSlot';
import Banner from '../packages/web/src/components/ui/Banner';
import SurfaceListItem from '../packages/web/src/components/ui/SurfaceListItem';
import {PROFILE_AVATAR_ACCEPT} from '../packages/web/src/utils/avatarUpload';
import type {MessageId} from '../packages/web/src/i18n/messages/en';
import type {NotificationChannel,NotificationUnsupportedReason} from '../packages/web/src/utils/notificationChannel';
import {useAccountSettings} from './AccountSettings';
const UNSUPPORTED_REASON_MESSAGE: Record<NotificationUnsupportedReason, MessageId> = {
  "no-window": "settings.notifications.unsupportedHint",
  "no-notification-api": "settings.notifications.unsupportedReason.noNotificationApi",
  "insecure-context": "settings.notifications.unsupportedReason.insecureContext",
  "no-service-worker": "settings.notifications.unsupportedReason.noServiceWorker",
  "no-push-manager": "settings.notifications.unsupportedReason.noPushManager",
};
export function LoomAccountSection(){const {formatMessage}=useIntl();const {user,displayName,saving,editingDisabled,saved,error,avatarSaving,avatarError,profileDirty,handleSaveProfile,handleUploadAvatar,handleDisplayNameChange}=useAccountSettings();if(!user)return null;return (<><div className="mb-6"><SectionHeader
          className="mb-3"
          icon={<User size={16} />}
          label={formatMessage({ id: "settings.account.sectionLabel" })}
        /><SettingsProfileCard
          testId="account-profile-card"
          title={user?.displayName || user?.name || formatMessage({ id: "settings.account.sectionLabel" })}
          subtitle={user?.name ? `@${user.name}` : ""}
          avatar={
            <Tooltip content={avatarSaving ? formatMessage({ id: "settings.common.uploadingAvatar" }) : formatMessage({ id: "settings.common.uploadImage" })}>
            <label
              className={`group/avatar-edit relative flex shrink-0 rounded-sticker has-[:focus-visible]:shadow-focus ${avatarSaving ? "cursor-not-allowed opacity-70" : ""}`}
            >
              <input
                type="file"
                accept={PROFILE_AVATAR_ACCEPT}
                className="peer/avatar-edit sr-only"
                aria-label={avatarSaving ? formatMessage({ id: "settings.common.uploadingAvatar" }) : formatMessage({ id: "settings.common.uploadImage" })}
                disabled={editingDisabled}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void handleUploadAvatar(file);
                }}
              />
              <AvatarSlot context="profile-tile" type="human" humanAvatarUrl={user?.avatarUrl} />
              <AvatarEditVeil busy={avatarSaving} />
            </label>
            </Tooltip>
          }
        >
          {avatarError ? (
            <p className="text-caption text-danger-strong" role="alert">{avatarError}</p>
          ) : null}
          {/* Profile form */}
          <form onSubmit={handleSaveProfile} className="space-y-3">
            <FormField label={formatMessage({ id: "settings.account.displayNameLabel" })} size="compact">
              <Input
                data-testid="account-profile-display-name-input"
                type="text"
                disabled={editingDisabled} maxLength={120} value={displayName}
                onChange={handleDisplayNameChange}
              />
            </FormField>
            <FormField label={formatMessage({ id: "settings.account.usernameLabel" })} size="compact">
              <PrefixedInput
                data-testid="account-profile-username-input"
                type="text"
                value={user?.name ?? ""}
                readOnly
                aria-readonly="true"
                tabIndex={-1}
                prefix="@"
                className="border-line-hairline bg-fill-muted shadow-none focus-within:shadow-none"
                inputClassName="cursor-default text-foreground-muted"
              />
            </FormField>
            

          {error && (
            <Banner intent="warning" density="sm">{error}</Banner>
          )}

            <Button
              type="submit"
              disabled={!profileDirty || saving}
              size="sm"
              variant="accent"
            >
              {saving ? formatMessage({ id: "settings.common.saving" }) : saved ? (
                <><Check size={14} /> {formatMessage({ id: "settings.common.saved" })}</>
              ) : formatMessage({ id: "settings.account.saveProfile" })}
            </Button>
          </form></SettingsProfileCard></div></>);}
export function LoomAboutSection({appVersion}:{appVersion:string}){const {formatMessage}=useIntl();return (<div className="space-y-6"><section className="space-y-3" data-testid="loom-about-version">
        <SectionHeader label={formatMessage({ id: "settings.about.versionSectionLabel" })} icon={<Tag size={16} />} />
        <SurfaceListItem interactive={false} className="space-y-1">
          {/* Product wordmark — catalog brand id; locale values may match. */}
          <div className="text-subhead font-semibold text-foreground">Loom</div>
          <div className="font-mono text-mono-meta text-foreground-muted">{appVersion}</div>
        </SurfaceListItem>
      </section></div>);}
export function LoomWorkspaceMute({currentServer,loading,busy,testing,muting,serverPushMuted,savedServerPushMuted,handleSaveServerMute,handleServerPushMutedChange}:{currentServer:{name:string};loading:boolean;busy:boolean;testing:boolean;muting:boolean;serverPushMuted:boolean;savedServerPushMuted:boolean;handleSaveServerMute:(event:FormEvent)=>void;handleServerPushMutedChange:(checked:boolean)=>void}){const {formatMessage}=useIntl();return <>{currentServer && (
          <div>
            <form onSubmit={handleSaveServerMute} className="space-y-3">
              <label className={`flex items-start gap-3 ${loading || busy || testing || muting ? "cursor-not-allowed" : ""}`}>
                <Checkbox
                  checked={serverPushMuted}
                  disabled={loading || busy || testing || muting}
                  onCheckedChange={handleServerPushMutedChange}
                />
                <span className="min-w-0">
                  <span className={`block text-subhead font-semibold ${loading || busy || testing || muting ? "text-foreground-disabled" : "text-foreground"}`}>{formatMessage({ id: "settings.notifications.muteServerTitle" })}</span>
                  <span className="block text-footnote text-foreground-muted mt-0.5">
                    {formatMessage({ id: "settings.notifications.muteServerDescription" }, { serverName: currentServer.name })}
                  </span>
                </span>
              </label>
              <div className="flex justify-end">
                <Button
                  variant="accent" size="md"
                  type="submit"
                  disabled={serverPushMuted === savedServerPushMuted || loading || busy || testing || muting}
                >
                  {muting ? formatMessage({ id: "settings.common.saving" }) : formatMessage({ id: "settings.common.save" })}
                </Button>
              </div>
            </form>
          </div>
        )}</>;}
export type NotificationViewProps={loading:boolean;subscribed:boolean;confirmed:boolean;busy:boolean;testing:boolean;message:string;handleEnable:()=>void;handleDisable:()=>void;handleSendTest:()=>void;children?:ReactNode;statusLabel:string;permission:NotificationPermission|'unsupported';serverConfigured:boolean;error:string;detail:string;channel:NotificationChannel;labels?:Partial<Record<string,string>>};
export function LoomNotificationStatus({loading,statusLabel,permission,serverConfigured,error,detail,channel,message,subscribed,confirmed,busy,testing,handleEnable,handleDisable,handleSendTest,children,labels}:NotificationViewProps){const intl=useIntl();const formatMessage=(input:{id:string})=>labels?.[input.id]??intl.formatMessage(input);const statusTone=!loading&&confirmed?'success':!loading&&permission==='denied'?'warning':'muted';return (<div><SectionHeader
        className="mb-3"
        icon={<Bell size={16} />}
        label={formatMessage({ id: "settings.notifications.sectionLabel" })}
      /><Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-subhead font-semibold text-foreground">{formatMessage({ id: "settings.notifications.mainTitle" })}</div>
            <div className="text-footnote text-foreground-muted mt-0.5">
              {formatMessage({ id: "settings.notifications.mainDescription" })}
            </div>
          </div>
          <Badge appearance="soft" variant={statusTone}>
            {statusLabel}
          </Badge>
        </div>

        {permission === "unsupported" && (
          <div className="text-footnote text-foreground-muted">
            {formatMessage({ id: channel.kind === "unsupported" ? UNSUPPORTED_REASON_MESSAGE[channel.reason] : "settings.notifications.unsupportedHint" })}
          </div>
        )}

        {permission !== "unsupported" && !serverConfigured && !loading && !error && (
          <div className="text-footnote text-foreground-muted">
            {formatMessage({ id: "settings.notifications.notConfiguredHint" })}
          </div>
        )}

        {permission === "denied" && (
          <div className="text-footnote text-foreground-muted">
            {formatMessage({ id: "settings.notifications.deniedHint" })}
          </div>
        )}

        {error && (
          <Banner intent="warning" density="sm">{error}</Banner>
        )}

        {message && (
          <Banner intent="success" density="sm" role="status">{message}</Banner>
        )}

        <div className="flex gap-2">
          {subscribed ? (
            <>
              <Button
                variant="outline" size="sm" type="button"
                onClick={handleDisable}
                disabled={loading || busy || testing}
              >
                {busy ? formatMessage({ id: "settings.notifications.disabling" }) : formatMessage({ id: "settings.notifications.disable" })}
              </Button>
              <Button
                variant="outline" size="sm" type="button"
                onClick={handleSendTest}
                disabled={loading || busy || testing || !confirmed || permission === "unsupported" || !serverConfigured}
              >
                {testing ? formatMessage({ id: "settings.notifications.sending" }) : formatMessage({ id: "settings.notifications.sendTest" })}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnable}
              disabled={loading || busy || testing || permission === "unsupported" || !serverConfigured}
            >
              {busy ? formatMessage({ id: "settings.notifications.enabling" }) : formatMessage({ id: "settings.notifications.enable" })}
            </Button>
          )}
        </div>

        <div className="text-footnote text-foreground-muted">{detail}</div>{children}</Card></div>);}
