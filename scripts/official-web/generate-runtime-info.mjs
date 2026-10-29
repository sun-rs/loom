import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { extractDeclarations } from "./generate-appearance.mjs";
const root = "frontends/raft/upstream/runtime-info-2026-10-29/";
export function generateRuntimeInfo() {
  const source = readFileSync(root + "RuntimeAccountUsageChip.tsx", "utf8");
  const ast = ts.createSourceFile(
    "upstream.tsx",
    source,
    99,
    true,
    ts.ScriptKind.TSX,
  );
  const chip = ast.statements.find(
    (n) =>
      ts.isFunctionDeclaration(n) && n.name?.text === "RuntimeAccountUsageChip",
  );
  const returns = chip.body.statements.filter(ts.isReturnStatement);
  let frame = returns.at(-1).expression.getText(ast);
  const start = frame.indexOf("{hasKnownState && ("),
    end = frame.indexOf("      </Badge>", start);
  if (start < 0 || end < 0) throw Error("Native runtime status slot changed");
  frame = frame.slice(0, start) + "{status}\n" + frame.slice(end);
  frame = frame
    .replace(
      "ref={triggerRef}",
      'data-testid="role-runtime-info-trigger" ref={triggerRef}',
    )
    .replace(
      'aria-label={typeof children === "string" ? children : providerName(provider)}',
      "aria-label={label}",
    )
    .replace(
      'aria-label={formatMessage({ id: "machine.runtimeUsage.dialogLabel" }, { provider: providerName(provider) })}',
      'aria-label={label+" 运行时信息"}',
    )
    .replace(
      "<BottomSheet onClose=",
      '<BottomSheet role="dialog" aria-label={label+" 运行时信息"} onClose=',
    );
  const surface = extractDeclarations(source, ["Surface"])[0];
  let header = surface.slice(
    surface.indexOf(
      '<div className="flex items-center justify-between gap-3 border-b',
    ),
    surface.indexOf("      <RuntimeUsageContents"),
  );
  header = header
    .replace(
      '{formatMessage({ id: "machine.runtimeUsage.title" }, { provider: providerName(provider) })}',
      "{label}",
    )
    .replace(
      "data-testid={`runtime-version-${provider}`}",
      'data-testid="runtime-info-version"',
    )
    .replace(
      '          <div className="text-caption text-foreground-hint">{formatMessage({ id: "machine.runtimeUsage.private" })}</div>\n',
      "",
    )
    .replace(
      'aria-label={formatMessage({ id: "machine.runtimeUsage.close" })}',
      'data-loom-control="detail-close" aria-label="关闭运行时信息"',
    );
  return `// GENERATED from preserved Raft db5e399 RuntimeAccountUsageChip presentation.\n// Loom supplies runtime facts/status/content; quota is not invented. Native badge/card/sheet geometry retained.\nimport type {ReactNode,RefObject,CSSProperties,ComponentProps} from 'react';\nimport {createPortal} from 'react-dom';\nimport {useIntl} from 'react-intl';\nimport {Badge,Card} from 'raft-ui';\nimport {X} from 'lucide-react';\nimport CloseButton from '../packages/web/src/components/ui/CloseButton.tsx';\nimport BottomSheet from '../packages/web/src/components/ui/BottomSheet';\nimport {dismissLayerProps,notDismissLayerProps} from '../packages/web/src/components/ui/dismissLayer';\n${extractDeclarations(source, ["HOVER_OPEN_DELAY_MS", "HOVER_CLOSE_DELAY_MS", "runtimeBadgeClassName"]).join("\n")}\nexport {HOVER_OPEN_DELAY_MS,HOVER_CLOSE_DELAY_MS};\nexport function OfficialRuntimeInfoBody({label,runtimeVersion,onClose,children}:{label:string;runtimeVersion?:string;onClose:()=>void;children:ReactNode}){const {formatMessage}=useIntl();return <div>${header}<div className="px-4 py-5">{children}</div></div>;}\nexport function OfficialRuntimeInfoFrame({label,children,status,surface,open,mobile,pinned,triggerRef,popoverRef,popoverStyle,handleMouseEnter,handleMouseLeave,handleFocus,handleBlur,pinOpen,closeSurface,cancelClose,closeSoon,className='',appearance='soft',variant='information'}:{label:string;children:ReactNode;status:ReactNode;surface:ReactNode;open:boolean;mobile:boolean;pinned:boolean;triggerRef:RefObject<HTMLButtonElement|null>;popoverRef:RefObject<HTMLDivElement|null>;popoverStyle:CSSProperties;handleMouseEnter:()=>void;handleMouseLeave:()=>void;handleFocus:()=>void;handleBlur:()=>void;pinOpen:()=>void;closeSurface:()=>void;cancelClose:()=>void;closeSoon:()=>void;className?:string;appearance?:ComponentProps<typeof Badge>['appearance'];variant?:ComponentProps<typeof Badge>['variant']}){return ${frame};}\n`;
}
if (process.argv[1]?.endsWith("generate-runtime-info.mjs")) {
  writeFileSync(
    "frontends/raft/loom/OfficialRuntimeInfo.generated.tsx",
    generateRuntimeInfo(),
  );
  writeFileSync(
    root + "provenance.json",
    JSON.stringify(
      {
        source: "https://github.com/botiverse/raft-source",
        revision: "db5e399f017d584e49597e3a28757645d6807893",
        path: "packages/web/src/components/machine/RuntimeAccountUsageChip.tsx",
        sha256: createHash("sha256")
          .update(readFileSync(root + "RuntimeAccountUsageChip.tsx"))
          .digest("hex"),
        license: "FSL-1.1-ALv2; ../../LICENSE retained; owner-authorized reuse",
        adopted:
          "Badge/frame/header JSX, status sizing, hover delays, mobile BottomSheet, viewport clamp and pinned dismiss semantics",
        local:
          "Metadata/status/content bindings; provider account reads/refresh/footer omitted because Loom has no account-quota owner; no quota inferred from CLI availability",
      },
      null,
      2,
    ) + "\n",
  );
}
