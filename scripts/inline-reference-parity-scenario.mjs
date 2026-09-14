import assert from "node:assert/strict";

// Raft index-MqTUR4Ez.js, SHA256 9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443,
// Lo (pretty line 141827), verified against the live message DOM on 2026-09-13.
// An independent same-text layout oracle, not the unused MessageReference library variant.
export async function assertInlineReferenceParity(page) {
  const measurements = await page.evaluate(() => {
    const results = [];
    for (const fontSize of [14, 16]) {
      for (const width of [180, 600]) {
        for (const [kind, label] of [
          ["self", "@owner"],
          ["task", "task #2"],
          ["room", "#a-long-channel-name-with-overflow"],
          ["thread", "#channel:thread"],
        ]) {
          const measure = (official) => {
            const row = document.createElement("p");
            row.style.cssText = `font-family:var(--sans);font-size:${fontSize}px;line-height:24px;width:${width}px;margin:0;white-space:normal`;
            row.append("正文 Before ");
            const badge = document.createElement(official ? "a" : "button");
            badge.textContent = label;
            if (official) {
              badge.style.cssText =
                "display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;border:1px solid black;padding:0 4px;font-size:.875em;font-weight:700;line-height:1.3em;user-select:text";
            } else {
              badge.className = `rah-rich-reference rah-rich-${kind}-reference`;
            }
            row.append(badge, " 后文 After");
            document.body.append(row);
            const box = badge.getBoundingClientRect();
            const parent = row.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(badge);
            const text = range.getBoundingClientRect();
            const css = getComputedStyle(badge);
            const result = {
              top: box.top - parent.top,
              width: box.width,
              height: box.height,
              rowHeight: parent.height,
              textTop: text.top - box.top,
              textBottom: box.bottom - text.bottom,
              selectable: css.userSelect ?? css.webkitUserSelect,
            };
            row.remove();
            return result;
          };
          results.push({
            case: `${fontSize}px/${width}px/${kind}`,
            official: measure(true),
            local: measure(false),
          });
        }
      }
    }
    return results;
  });
  for (const sample of measurements) {
    for (const key of [
      "top",
      "width",
      "height",
      "rowHeight",
      "textTop",
      "textBottom",
    ])
      assert.ok(
        Math.abs(sample.local[key] - sample.official[key]) <= 0.5,
        `${sample.case} ${key}: RAH ${sample.local[key]}, Raft ${sample.official[key]}`,
      );
    assert.equal(sample.local.selectable, "text", sample.case);
  }
  await page.evaluate(() => {
    const badge = document.createElement("button");
    badge.className = "rah-rich-reference rah-rich-self-reference";
    badge.dataset.referenceHoverProbe = "true";
    badge.textContent = "@owner";
    badge.style.cssText = "position:fixed;top:10px;left:10px;z-index:9999";
    document.body.append(badge);
  });
  const badge = page.locator("[data-reference-hover-probe]");
  try {
    await badge.hover();
    const alpha = await badge.evaluate((element) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    });
    assert.equal(alpha, 204, "Raft self mention hover uses 80% signal color");
  } finally {
    await badge.evaluate((element) => element.remove());
  }
}
