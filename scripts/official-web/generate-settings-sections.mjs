import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclarations } from "./generate-appearance.mjs";
const sourcePath =
  "frontends/raft/upstream/raft-web-source/packages/web/src/components/settings/SettingsPanel.tsx";
export function extractSettingsSections(
  source = readFileSync(sourcePath, "utf8"),
) {
  const file = ts.createSourceFile(
    "official.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (file.parseDiagnostics.length)
    throw Error("Official settings syntax changed");
  const fn = (name) => {
    const matches = file.statements.filter(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
    );
    if (matches.length !== 1)
      throw Error(`Official function boundary changed: ${name}`);
    return matches[0];
  };
  const elements = (owner, predicate) => {
    const rows = [];
    function visit(n) {
      if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && predicate(n))
        rows.push(n);
      ts.forEachChild(n, visit);
    }
    visit(owner);
    return rows;
  };
  const one = (rows, name) => {
    if (rows.length !== 1)
      throw Error(`Official JSX boundary changed: ${name}`);
    return rows[0];
  };
  const patch = (text, from, to) => {
    if (text.split(from).length !== 2)
      throw Error(`Compatibility boundary changed: ${from}`);
    return text.replace(from, to);
  };
  const tag = (n) =>
    (ts.isJsxSelfClosingElement(n)
      ? n.tagName
      : n.openingElement.tagName
    ).getText(file);
  // Account: only the profile form, no cloud identities/email/password sections.
  const account = fn("AccountSection");
  const card = one(
    elements(account, (n) => tag(n) === "SettingsProfileCard"),
    "account card",
  );
  const form = one(
    elements(
      card,
      (n) =>
        tag(n) === "form" &&
        n.openingElement.getText(file).includes("handleSaveProfile"),
    ),
    "profile form",
  );
  const header = one(
    elements(
      account,
      (n) =>
        tag(n) === "SectionHeader" &&
        n.getText(file).includes("settings.account.sectionLabel"),
    ),
    "account header",
  );
  const email = one(
    elements(
      form,
      (n) =>
        tag(n) === "FormField" &&
        n.openingElement.getText(file).includes("settings.account.emailLabel"),
    ),
    "email field",
  );
  let cardText =
    source.slice(card.getStart(file), form.end) +
    card.closingElement.getText(file);
  cardText = patch(cardText, email.getText(file), "");
  cardText = patch(cardText, " email={user?.email}", "");
  // Existing Loom write fences: preserve disabled editing and backend length limit.
  cardText = patch(
    cardText,
    "disabled={avatarSaving}",
    "disabled={editingDisabled}",
  );
  cardText = patch(
    cardText,
    "value={displayName}",
    "disabled={editingDisabled} maxLength={120} value={displayName}",
  );
  const accountJsx = `<><div className="mb-6">${header.getText(file)}${cardText}</div></>`;
  // About: retain only version section, rename brand, omit upstream download/cloud controls.
  let about = one(
    elements(
      fn("AboutSection"),
      (n) =>
        tag(n) === "section" &&
        n.getText(file).includes("settings.about.versionSectionLabel"),
    ),
    "about version",
  ).getText(file);
  about = patch(
    about,
    '<section className="space-y-3">',
    '<section className="space-y-3" data-testid="loom-about-version">',
  );
  about = patch(about, '{formatMessage({ id: "brand.productName" })}', "Loom");
  // System-channel form is byte-exact; existing controller remains authoritative.
  const system = one(
    elements(
      fn("SystemChannelsSection"),
      (n) =>
        tag(n) === "div" &&
        n.getText(file).includes("settings.systemChannels.sectionLabel"),
    ),
    "system form",
  ).getText(file);
  // Notifications: native browser controls and separately bound workspace-mute form.
  const notification = fn("WebPushNotificationsCard");
  const notificationCard = one(
    elements(notification, (n) => tag(n) === "Card"),
    "notification card",
  );
  const notificationHeader = one(
    elements(notification, (n) => tag(n) === "SectionHeader"),
    "notification header",
  );
  const stop = notificationCard.children.find(
    (n) =>
      ts.isJsxExpression(n) && n.getText(file).startsWith("{currentServer &&"),
  );
  if (!stop) throw Error("Official server mute boundary changed");
  let notify = source.slice(
    notificationCard.getStart(file),
    stop.getStart(file),
  );
  // Existing unknown/loading guards are retained, not upstream success assumptions.
  notify = patch(
    notify,
    "!serverConfigured && !loading &&",
    "!serverConfigured && !loading && !error &&",
  );
  if (notify.split("disabled={busy || testing").length !== 4)
    throw Error("Official notification actions changed");
  notify = notify.replaceAll(
    "disabled={busy || testing",
    "disabled={loading || busy || testing",
  );
  // Send-test only: enabling still works when no subscription has been confirmed.
  notify = patch(
    notify,
    "onClick={handleSendTest}\n                disabled={loading || busy || testing",
    "onClick={handleSendTest}\n                disabled={loading || busy || testing || !confirmed",
  );
  notify += `<div className="text-footnote text-foreground-muted">{detail}</div>{children}</Card>`;
  return {
    account: accountJsx,
    about: `<div className="space-y-6">${about}</div>`,
    system,
    notification: `<div>${notificationHeader.getText(file)}${notify}</div>`,
    workspaceMute: stop.getText(file),
    reasons: extractDeclarations(source, ["UNSUPPORTED_REASON_MESSAGE"])[0],
  };
}
export function generateSettingsSections() {
  const parts = extractSettingsSections();
  return `// GENERATED from pinned official SettingsPanel. Explicit omissions and write-fence patches are recorded in generate-settings-sections.mjs and ui-contract.json.\nimport type {ReactNode,FormEvent} from 'react';
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
import {useSystemSettings} from './SystemSettings';
${parts.reasons}
export function LoomAccountSection(){const {formatMessage}=useIntl();const {user,displayName,saving,editingDisabled,saved,error,avatarSaving,avatarError,profileDirty,handleSaveProfile,handleUploadAvatar,handleDisplayNameChange}=useAccountSettings();if(!user)return null;return (${parts.account});}
export function LoomAboutSection({appVersion}:{appVersion:string}){const {formatMessage}=useIntl();return (${parts.about});}
export function SystemChannelsSection(){const {formatMessage}=useIntl();const {allChannelHidden,saving,saved,error,dirty,handleSave,handleAllChannelHiddenChange,ready}=useSystemSettings();if(!ready)return null;return (${parts.system});}
export function LoomWorkspaceMute({currentServer,loading,busy,testing,muting,serverPushMuted,savedServerPushMuted,handleSaveServerMute,handleServerPushMutedChange}:{currentServer:{name:string};loading:boolean;busy:boolean;testing:boolean;muting:boolean;serverPushMuted:boolean;savedServerPushMuted:boolean;handleSaveServerMute:(event:FormEvent)=>void;handleServerPushMutedChange:(checked:boolean)=>void}){const {formatMessage}=useIntl();return <>${parts.workspaceMute}</>;}
export type NotificationViewProps={loading:boolean;subscribed:boolean;confirmed:boolean;busy:boolean;testing:boolean;message:string;handleEnable:()=>void;handleDisable:()=>void;handleSendTest:()=>void;children?:ReactNode;statusLabel:string;permission:NotificationPermission|'unsupported';serverConfigured:boolean;error:string;detail:string;channel:NotificationChannel;labels?:Partial<Record<string,string>>};
export function LoomNotificationStatus({loading,statusLabel,permission,serverConfigured,error,detail,channel,message,subscribed,confirmed,busy,testing,handleEnable,handleDisable,handleSendTest,children,labels}:NotificationViewProps){const intl=useIntl();const formatMessage=(input:{id:string})=>labels?.[input.id]??intl.formatMessage(input);const statusTone=!loading&&confirmed?'success':!loading&&permission==='denied'?'warning':'muted';return (${parts.notification});}\n`;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialSettingsSections.generated.tsx",
    generateSettingsSections(),
  );
