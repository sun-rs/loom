import assert from "node:assert/strict";
import test from "node:test";
import { choiceRowViolations } from "../../../scripts/ui-choice-contract.mjs";
import { cssContractInputs } from "../../../scripts/ui-css-contract.mjs";

const consumer = `import { ChoiceRow } from '@rah-os/ui-web/neo-brutalist/choice-row';
const row = <ChoiceRow profile="autocomplete" className="candidate" />;`;
test("choice rows reject local colors, modal overrides and state opacity", () => {
  for (const rule of [
    ".candidate:hover { background: red; }",
    ":where(.candidate):hover { background: red; }",
    ".modal :is(.candidate, .another) { background: red; }",
    ".candidate { --yellow: red; }",
    '[role="dialog"] .candidate { background-color: yellow !important; }',
    ".candidate[data-choice-current] { opacity: .3; }",
    ".rah-choice-row { --choice-hover: red; }",
  ]) {
    assert.ok(
      choiceRowViolations({ "page.tsx": consumer, "page.css": rule }).length,
      rule,
    );
  }
  assert.deepEqual(
    choiceRowViolations({
      "page.tsx": consumer,
      "page.css":
        ".candidate { padding: 8px; } .candidate > svg { color: red; }",
    }),
    [],
  );
});
test("choice rows reject inline styling, prop spreads and hand-written profile attributes", () => {
  for (const source of [
    '<ChoiceRow profile="member-browse" style={{background: "red"}} />',
    '<ChoiceRow {...localProps} profile="member-browse" />',
    '<button data-choice-profile="member-browse" />',
  ])
    assert.ok(choiceRowViolations({ "page.tsx": source }).length, source);
});
test("all migrated product choice rows keep presentation in the shared owner", () => {
  assert.deepEqual(choiceRowViolations(cssContractInputs()), []);
});
