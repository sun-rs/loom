/** Select the official local-profile surface, omitting cloud-account-only sections. */
export function exposeAccountProfile(source: string) {
  const start = source.indexOf("export function AccountSection({");
  const render = source.indexOf(
    '  return (\n    <>\n      <div className="mb-6">',
    start,
  );
  const end = source.indexOf("          </form>", render);
  if (start < 0 || render < 0 || end < 0)
    throw Error("Official account profile boundary changed");
  let jsx = source.slice(render, end + "          </form>".length);
  const email = jsx.indexOf(
    '            <FormField label={formatMessage({ id: "settings.account.emailLabel" })}',
  );
  const error = jsx.indexOf("          {error && (", email);
  if (email < 0 || error < 0 || !jsx.includes('testId="account-profile-card"'))
    throw Error("Official account email boundary changed");
  jsx = jsx.slice(0, email) + jsx.slice(error);
  jsx = jsx.replace("disabled={avatarSaving}", "disabled={editingDisabled}");
  jsx = jsx.replace(
    "                value={displayName}",
    "                disabled={editingDisabled}\n                maxLength={120}\n                value={displayName}",
  );
  return (
    'import { useAccountSettings } from "loom-account-settings";\n' +
    source +
    "\nexport function LoomAccountSection() {\n  const { formatMessage } = useIntl();\n  const themeFamily = useThemeFamily();\n  const { user, displayName, saving, editingDisabled, saved, error, avatarSaving, avatarError, profileDirty, handleSaveProfile, handleUploadAvatar, handleDisplayNameChange } = useAccountSettings();\n  if (!user) return null;\n" +
    jsx +
    "\n        </SettingsProfileCard>\n      </div>\n    </>\n  );\n}\n"
  );
}
