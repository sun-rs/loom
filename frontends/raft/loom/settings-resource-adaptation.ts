/** Select native presentation only; Loom owns data, upstream files stay intact. */
export function exposeNotificationStatus(source: string) {
  const start = source.indexOf("function WebPushNotificationsCard(");
  const begin = source.indexOf(
    "  return (",
    source.indexOf("const statusLabel", start),
  );
  const end = source.indexOf("        {currentServer && (", begin);
  if (start < 0 || begin < 0 || end < 0)
    throw Error("Official notification card boundary changed");
  const jsx = source
    .slice(begin + "  return (".length, end)
    .replace(
      "!serverConfigured && !loading &&",
      "!serverConfigured && !loading && !error &&",
    )
    .replaceAll(
      "disabled={busy || testing",
      "disabled={loading || busy || testing",
    )
    .replace(
      "disabled={loading || busy || testing || permission",
      "disabled={loading || busy || testing || !confirmed || permission",
    );
  return (
    source +
    `\nexport function LoomNotificationStatus({loading,statusLabel,permission,serverConfigured,error,detail,channel,message,subscribed,confirmed,busy,testing,handleEnable,handleDisable,handleSendTest,children}: any) {\n const {formatMessage}=useIntl(); const statusVariant = !loading && confirmed ? "success" : !loading && permission === "denied" ? "warning" : "muted"; return (${jsx}<div className="text-footnote text-foreground-muted">{detail}</div>{children}</Card></div>); }\n`
  );
}
