import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
export function generateConfirmation() {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/ConfirmDialog.tsx",
    "utf8",
  );
  return (
    `// GENERATED: unchanged db5e399 confirmation declarations. Only imports bind existing presentation dependencies.
import {useCallback,useMemo,useState} from "react";
import type {ReactNode} from "react";
import {useIntl} from "react-intl";
import type {Locale} from "../packages/web/src/i18n/locale";
import {mergedMessages} from "../packages/web/src/i18n/messages";
import type {MessageId} from "../packages/web/src/i18n/messages";
import Banner from "@loom/raft-web-source/Banner";
import {Dialog,DialogBody,DialogClose,DialogContent,DialogFooter,DialogHeader,DialogTitle,Spinner,Button} from "raft-ui";
import type {ButtonProps} from "raft-ui";
` +
    ["ConfirmDialogProps", "ConfirmDialog"]
      .map((n) => extractDeclaration(source, n))
      .join("\n\n") +
    "\n"
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeFileSync(
    "frontends/raft/loom/OfficialConfirmation.generated.tsx",
    generateConfirmation(),
  );
