import { legacyAvatarAssets } from "./legacy-avatar-assets.ts";
import { adaptNativeCapabilities } from "./policy.ts";
import { localFontDelivery } from "./fonts.ts";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import officialConfig from "../upstream/web-1.21.23/packages/web/vite.config.ts";
const root = resolve(
  import.meta.dirname,
  "../upstream/web-1.21.23/packages/web",
);
const require = createRequire(root + "/package.json");
const uiManifest = require("@botiverse/raft-ui/package.json");
if (
  uiManifest.version !== "0.7.0" ||
  require.resolve("raft-ui/package.json") !==
    require.resolve("@botiverse/raft-ui/package.json")
)
  throw Error("Pinned UI alias/runtime mismatch");
const packages = [
  "react",
  "react-dom",
  "react-router-dom",
  "axios",
  "lucide-react",
  "zustand",
  "react-intl",
];
export default defineConfig({
  ...officialConfig,
  root,
  define: {
    ...officialConfig.define,
    "import.meta.env.VITE_API_URL": JSON.stringify(""),
  },
  css: {
    ...officialConfig.css,
    postcss: {
      plugins: [
        tailwindcss(),
        {
          postcssPlugin: "loom-native123-font-delivery",
          OnceExit(root) {
            const text = localFontDelivery(root.toString());
            root
              .removeAll()
              .append(postcss.parse(text, { from: root.source?.input.file }));
          },
        },
      ],
    },
  },
  resolve: {
    ...officialConfig.resolve,
    alias: Object.fromEntries(
      packages.map((name) => [
        name,
        resolve(require.resolve(name + "/package.json"), ".."),
      ]),
    ),
  },
  plugins: [
    legacyAvatarAssets(),
    {
      name: "loom-native123-boundary",
      enforce: "pre",
      transform(code, id) {
        if (id.startsWith(root + "/src/")) {
          const adapted = adaptNativeCapabilities(code, id);
          if (adapted !== code) return { code: adapted, map: null };
        }
      },
      generateBundle(_, bundle) {
        const modules = Object.values(bundle).flatMap((chunk) =>
          chunk.type === "chunk" ? Object.keys(chunk.modules) : [],
        );
        const legacy = modules.filter((id) =>
          /frontends\/raft\/(loom\/.*\.tsx|packages\/web\/src\/|.*Official.*generated)/.test(
            id,
          ),
        );
        if (legacy.length)
          throw Error("Legacy UI in native123 graph: " + legacy.join(","));
        const runtimeRoots = Object.fromEntries(
          ["react", "react-dom", "@botiverse/raft-ui"].map((name) => {
            const marker = "/node_modules/" + name + "/",
              roots = [
                ...new Set(
                  modules
                    .filter((id) => id.includes(marker))
                    .map((id) =>
                      id.slice(0, id.lastIndexOf(marker) + marker.length),
                    ),
                ),
              ];
            if (roots.length !== 1)
              throw Error(
                "Expected one native " +
                  name +
                  " runtime; found " +
                  roots.length,
              );
            return [
              name,
              roots.map((id) =>
                id.slice(id.indexOf("/node_modules/.pnpm/") + 20),
              ),
            ];
          }),
        );
        const native = modules.filter((id) => id.startsWith(root + "/src/"));
        if (
          !native.some((id) => id.endsWith("/main.tsx")) ||
          !native.some((id) => id.endsWith("/App.tsx")) ||
          !native.some((id) => id.endsWith("/components/layout/MainLayout.tsx"))
        )
          throw Error("Complete native shell missing");
        this.emitFile({
          type: "asset",
          fileName: "native-boundary.json",
          source: JSON.stringify(
            {
              source: "db5e399",
              ui: "0.7.0",
              nativeModules: native.map((id) => id.slice(root.length + 1)),
              legacyUiModules: legacy,
              runtimeRoots,
              dependencyVersions: Object.fromEntries(
                ["@botiverse/raft-ui", "react", "react-dom"].map((name) => [
                  name,
                  require(name + "/package.json").version,
                ]),
              ),
            },
            null,
            2,
          ),
        });
      },
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html.replace(
            "/src/main.tsx",
            "/@fs" + resolve(import.meta.dirname, "entry.ts"),
          ),
      },
      resolveId(source, importer) {
        if (!importer?.startsWith(root + "/src/")) return;
        if (source === "@botiverse/raft-shared")
          return resolve(import.meta.dirname, "runtime-shared.ts");
        const path = source.startsWith(".")
          ? resolve(importer, "..", source).replace(/\.(tsx?|jsx?)$/, "")
          : "";
        if (
          path === root + "/src/store/agentStore" &&
          (importer.endsWith("/components/layout/Sidebar.tsx") ||
            importer.endsWith("/components/channel/CreateChannelDialog.tsx") ||
            importer.endsWith("/components/agent/ChannelMembers.tsx") ||
            importer.endsWith("/components/agent/CreateAgentDialog.tsx"))
        )
          return resolve(import.meta.dirname, "role-agent-store.ts");
        if (
          path === root + "/src/store/agentStore" &&
          importer.includes("/components/machine/")
        )
          return resolve(import.meta.dirname, "instance-agent-store.ts");
        if (path === root + "/src/components/agent/AgentSkills")
          return resolve(import.meta.dirname, "absent-skill-section.tsx");
        if (path === root + "/src/store/mainLayoutRealtimeBridgeDriver")
          return resolve(import.meta.dirname, "realtime-driver.ts");
        if (path === root + "/src/api/client")
          return resolve(import.meta.dirname, "api.ts");
        if (path === root + "/src/api/socket")
          return resolve(import.meta.dirname, "socket.ts");
      },
    },
    ...(officialConfig.plugins ?? []),
  ],
  build: {
    ...officialConfig.build,
    outDir: resolve(import.meta.dirname, "../dist-native123"),
    emptyOutDir: true,
  },
});
