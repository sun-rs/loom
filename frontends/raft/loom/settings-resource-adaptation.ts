/** Select native presentation only; Loom owns data, upstream files stay intact. */
export function exposeNotificationStatus(source: string) {
  const start = source.indexOf("function WebPushNotificationsCard(");
  const begin = source.indexOf(
    "  return (",
    source.indexOf("const statusLabel", start),
  );
  const end = source.indexOf('        <div className="flex gap-2">', begin);
  if (start < 0 || begin < 0 || end < 0)
    throw Error("Official notification card boundary changed");
  const jsx = source
    .slice(begin + "  return (".length, end)
    .replace(
      "!serverConfigured && !loading &&",
      "!serverConfigured && !loading && !error &&",
    );
  return (
    source +
    `\nexport function LoomNotificationStatus({loading,statusLabel,permission,serverConfigured,error,detail,channel}: {loading:boolean;statusLabel:string;permission:NotificationPermission|"unsupported";serverConfigured:boolean;error:string;detail:string;channel:any}) {\n const {formatMessage}=useIntl(); const message=""; const statusVariant = !loading && permission === "denied" ? "warning" : "muted"; return (${jsx}<div className="text-footnote text-foreground-muted">{detail}</div></Card></div>); }\n`
  );
}
export function exposeReleaseNotes(source: string) {
  const begin = source.indexOf(
    '        <div className="mb-4 flex items-center gap-2">',
  );
  const end = source.indexOf("\n      </div>\n    </div>\n  );", begin);
  if (begin < 0 || end < 0)
    throw Error("Official release notes boundary changed");
  return (
    source +
    `\nexport function LoomReleaseNotes({releases}: {releases:Array<Pick<PublishedReleaseNote,"releaseId"|"version"|"date"|"state"|"entries">>}) { const {formatMessage}=useIntl(); const state={status:"ready" as string,releases}; const currentReleaseId=releases[0]?.releaseId; const handleRetry=()=>{}; return (<>${source.slice(begin, end)}</>); }\n`
  );
}
