/** Select the official version section; cloud downloads/feedback are not Loom services. */
export function exposeAboutVersion(source: string) {
  const start = source.indexOf("export function AboutSection({");
  const section = source.indexOf(
    '      <section className="space-y-3">',
    start,
  );
  const end = source.indexOf("      </section>", section);
  if (
    start < 0 ||
    section < 0 ||
    end < 0 ||
    !source.slice(section, end).includes("settings.about.versionSectionLabel")
  )
    throw Error("Official about version section changed");
  const jsx = source
    .slice(section, end + "      </section>".length)
    .replace(
      '<section className="space-y-3">',
      '<section className="space-y-3" data-testid="loom-about-version">',
    )
    .replace('{formatMessage({ id: "brand.productName" })}', "Loom");
  return (
    source +
    '\nexport function LoomAboutSection({appVersion}: {appVersion: string}) {\n const {formatMessage}=useIntl();\n return <div className="space-y-6">' +
    jsx +
    "</div>;\n}\n"
  );
}
