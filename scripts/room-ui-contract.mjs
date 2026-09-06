import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const DEFAULT_REGISTRY_PATH = "docs/ui/raft-behavior-registry.json";
const DEFAULT_MANIFEST_PATH = "docs/ui/evidence/manifest.json";
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_TYPES = new Set([
  "official-shipped-artifact",
  "official-shipped-bundle",
  "official-browser-observation",
  "official-documentation",
  "rah-owned-design",
]);
const CLASSIFICATIONS = new Set([
  "official-original",
  "extracted-transplanted",
  "reference-rebuilt",
  "rah-local-adaptation",
]);
const CLASSIFICATION_SOURCE_TYPES = new Map([
  ["official-original", new Set(["official-shipped-artifact"])],
  ["extracted-transplanted", new Set(["official-shipped-bundle"])],
  [
    "reference-rebuilt",
    new Set(["official-browser-observation", "official-documentation"]),
  ],
  ["rah-local-adaptation", new Set(["rah-owned-design"])],
]);
const DEFAULT_PRODUCTION_ROOTS = [
  "packages/client-web/src",
];
const DEFAULT_DEPENDENCY_POLICY_FILES = [
  "package.json",
  "package-lock.json",
  "packages/client-web/package.json",
  "packages/client-web/tsconfig.json",
  "packages/client-web/vite.config.ts",
  "scripts/build-web-client.mjs",
];
const DEFAULT_ASSET_ROOTS = ["packages/client-web/public"];
const PRODUCTION_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);
const ASSET_TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".svg",
  ".webmanifest",
]);
const EXTERNAL_REFERENCE_PATTERN = /(?:rah_os|raft-ui|raft_ui)/u;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function repositoryFile(root, relativePath, label) {
  const value = requireString(relativePath, label);
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  const resolvedRoot = realpathSync(root);
  const resolved = path.resolve(resolvedRoot, value);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`${label} escapes the repository: ${value}`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`missing ${label}: ${value}`);
  }
  const real = realpathSync(resolved);
  if (real !== resolvedRoot && !real.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} resolves outside the repository: ${value}`);
  }
  if (!statSync(real).isFile()) {
    throw new Error(`${label} is not a file: ${value}`);
  }
  return real;
}

function fileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function collectProductionFiles(root, relativeRoot) {
  const absoluteRoot = path.resolve(root, relativeRoot);
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
    throw new Error(`missing Room UI production root: ${relativeRoot}`);
  }
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `${path.relative(root, absolute)} must not be a symbolic link`,
        );
      } else if (entry.isDirectory()) {
        visit(absolute);
      } else if (
        entry.isFile() &&
        PRODUCTION_EXTENSIONS.has(path.extname(entry.name)) &&
        !/\.(?:test|spec)\.[^.]+$/u.test(entry.name)
      ) {
        result.push(path.relative(root, absolute));
      }
    }
  };
  visit(absoluteRoot);
  return result.sort();
}

function validateOwnedAssetTree(root, relativeRoot) {
  const absoluteRoot = path.resolve(root, relativeRoot);
  if (!existsSync(absoluteRoot)) return;
  const resolvedRoot = realpathSync(root);
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const real = realpathSync(absolute);
        if (real !== resolvedRoot && !real.startsWith(`${resolvedRoot}${path.sep}`)) {
          throw new Error(`${path.relative(root, absolute)} resolves outside the repository`);
        }
        continue;
      }
      if (entry.isDirectory()) visit(absolute);
      else if (
        entry.isFile() &&
        ASSET_TEXT_EXTENSIONS.has(path.extname(entry.name)) &&
        EXTERNAL_REFERENCE_PATTERN.test(readFileSync(absolute, "utf8"))
      ) {
        throw new Error(
          `${path.relative(root, absolute)} references an external reference checkout`,
        );
      }
    }
  };
  visit(absoluteRoot);
}

function objectInitializer(source, declarationName) {
  const declaration = source.indexOf(declarationName);
  if (declaration < 0) throw new Error(`missing ${declarationName} declaration`);
  const assignment = source.indexOf("=", declaration);
  const start = source.indexOf("{", assignment);
  if (assignment < 0 || start < 0) {
    throw new Error(`missing ${declarationName} object initializer`);
  }
  let depth = 0;
  let quote;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return runInNewContext(`(${source.slice(start, index + 1)})`, {}, {
          timeout: 1_000,
        });
      }
    }
  }
  throw new Error(`unterminated ${declarationName} object initializer`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function validateExtractedAvatarOwner(root, artifactsByPath) {
  const evidence = artifactsByPath.get(
    "docs/ui/evidence/raft-web-avatar-presets-20260825.json",
  );
  if (!evidence) return;
  const content = evidence.artifact.extraction.content;
  const ownerPath = repositoryFile(
    root,
    "packages/client-web/src/room-ui/AgentAvatar.tsx",
    "Agent avatar owner",
  );
  const source = readFileSync(ownerPath, "utf8");
  const actualPresets = objectInitializer(source, "OFFICIAL_AGENT_AVATARS");
  const actualPalette = objectInitializer(source, "PALETTE");
  const expectedPalette = { ...content.palette };
  delete expectedPalette._;
  if (
    JSON.stringify(canonicalJson(actualPresets)) !==
      JSON.stringify(canonicalJson(content.presets)) ||
    JSON.stringify(canonicalJson(actualPalette)) !==
      JSON.stringify(canonicalJson(expectedPalette))
  ) {
    throw new Error(
      "Agent avatar owner diverges from the verified official preset evidence",
    );
  }
}

function resolveJsonPointer(document, pointer) {
  if (pointer === "") return document;
  if (typeof pointer !== "string" || !pointer.startsWith("/")) return undefined;
  let current = document;
  for (const encodedToken of pointer.slice(1).split("/")) {
    const token = encodedToken.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || !(token in current))
      return undefined;
    current = current[token];
  }
  return current;
}

function validateEvidenceArtifact(root, manifestEntry) {
  const artifactId = requireString(
    manifestEntry.artifactId,
    "evidence artifactId",
  );
  const relativePath = requireString(
    manifestEntry.path,
    `${artifactId} manifest path`,
  );
  if (!relativePath.startsWith("docs/ui/evidence/")) {
    throw new Error(`${artifactId} evidence must live under docs/ui/evidence`);
  }
  const artifactPath = repositoryFile(
    root,
    relativePath,
    `${artifactId} evidence artifact`,
  );
  const expectedSha = requireString(
    manifestEntry.sha256,
    `${artifactId} manifest sha256`,
  );
  if (!SHA256.test(expectedSha))
    throw new Error(`${artifactId} manifest sha256 is invalid`);
  const actualSha = fileSha256(artifactPath);
  if (actualSha !== expectedSha) {
    throw new Error(
      `${artifactId} manifest sha256 does not match artifact bytes`,
    );
  }

  const artifact = requireObject(
    parseJson(artifactPath, artifactId),
    artifactId,
  );
  if (artifact.schemaVersion !== 1 || artifact.artifactId !== artifactId) {
    throw new Error(`${artifactId} evidence identity is invalid`);
  }
  const source = requireObject(artifact.source, `${artifactId} source`);
  const sourceType = requireString(source.type, `${artifactId} source type`);
  if (!SOURCE_TYPES.has(sourceType))
    throw new Error(`${artifactId} has unsupported source type`);
  const upstreamIdentifier = requireString(
    source.upstreamIdentifier,
    `${artifactId} upstreamIdentifier`,
  );
  const upstreamVersion = requireString(
    source.upstreamVersion,
    `${artifactId} upstreamVersion`,
  );
  requireString(source.capturedAt, `${artifactId} capturedAt`);
  if (
    (sourceType === "official-shipped-artifact" ||
      sourceType === "official-shipped-bundle") &&
    !SHA256.test(
      requireString(source.upstreamSha256, `${artifactId} upstreamSha256`),
    )
  ) {
    throw new Error(`${artifactId} upstreamSha256 is invalid`);
  }
  const extraction = requireObject(
    artifact.extraction,
    `${artifactId} extraction`,
  );
  requireString(extraction.method, `${artifactId} extraction method`);
  requireString(extraction.location, `${artifactId} extraction location`);
  if (!("content" in extraction))
    throw new Error(`${artifactId} extraction content is missing`);

  if (
    manifestEntry.sourceType !== sourceType ||
    manifestEntry.upstreamIdentifier !== upstreamIdentifier ||
    manifestEntry.upstreamVersion !== upstreamVersion
  ) {
    throw new Error(
      `${artifactId} manifest provenance does not match artifact provenance`,
    );
  }
  return { artifact, path: relativePath, sha256: actualSha, sourceType };
}

export function validateRoomUiContract(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const registryRelativePath = options.registryPath ?? DEFAULT_REGISTRY_PATH;
  const manifestRelativePath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const registryPath = repositoryFile(
    root,
    registryRelativePath,
    "Room UI behavior registry",
  );
  const manifestPath = repositoryFile(
    root,
    manifestRelativePath,
    "Room UI evidence manifest",
  );
  const registry = requireObject(
    parseJson(registryPath, "Room UI behavior registry"),
    "Room UI behavior registry",
  );
  const manifest = requireObject(
    parseJson(manifestPath, "Room UI evidence manifest"),
    "Room UI evidence manifest",
  );
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.contracts)) {
    throw new Error("Room UI behavior registry is invalid");
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) {
    throw new Error("Room UI evidence manifest is invalid");
  }
  const baseline = requireObject(
    registry.baseline,
    "Room UI behavior registry baseline",
  );
  if (baseline.evidenceManifest !== manifestRelativePath) {
    throw new Error(
      "Room UI behavior registry does not name the verified evidence manifest",
    );
  }

  const artifactsByPath = new Map();
  const artifactIds = new Set();
  for (const rawEntry of manifest.artifacts) {
    const entry = requireObject(rawEntry, "evidence manifest entry");
    const artifactId = requireString(entry.artifactId, "evidence artifactId");
    if (artifactIds.has(artifactId))
      throw new Error(`duplicate evidence artifactId ${artifactId}`);
    artifactIds.add(artifactId);
    const evidence = validateEvidenceArtifact(root, entry);
    if (artifactsByPath.has(evidence.path)) {
      throw new Error(`duplicate evidence artifact path ${evidence.path}`);
    }
    artifactsByPath.set(evidence.path, evidence);
  }

  const ids = new Set();
  const validateContractEvidence = (reference, label) => {
    const sourceArtifact = requireString(
      reference.sourceArtifact,
      `${label} sourceArtifact`,
    );
    if (
      path.isAbsolute(sourceArtifact) ||
      !sourceArtifact.startsWith("docs/ui/evidence/")
    ) {
      throw new Error(
        `${label} must use a repository-relative sourceArtifact under docs/ui/evidence`,
      );
    }
    const evidence = artifactsByPath.get(sourceArtifact);
    if (!evidence)
      throw new Error(`${label} has missing sourceArtifact: ${sourceArtifact}`);
    const sourceSha256 = requireString(
      reference.sourceSha256,
      `${label} sourceSha256`,
    );
    if (sourceSha256 !== evidence.sha256) {
      throw new Error(`${label} sourceSha256 does not match artifact bytes`);
    }
    const sourceLocator = requireString(
      reference.sourceLocator,
      `${label} sourceLocator`,
    );
    if (resolveJsonPointer(evidence.artifact, sourceLocator) === undefined) {
      throw new Error(
        `${label} sourceLocator does not resolve: ${sourceLocator}`,
      );
    }
    return evidence;
  };
  for (const rawContract of registry.contracts) {
    const contract = requireObject(rawContract, "Room UI behavior contract");
    const id = requireString(contract.id, "Room UI behavior contract id");
    if (ids.has(id)) throw new Error(`Duplicate contract id ${id}`);
    ids.add(id);
    if (!CLASSIFICATIONS.has(contract.classification)) {
      throw new Error(
        `${id} has unsupported classification ${String(contract.classification)}`,
      );
    }
    const primaryEvidence = validateContractEvidence(contract, id);
    const permittedSourceTypes = CLASSIFICATION_SOURCE_TYPES.get(
      contract.classification,
    );
    if (!permittedSourceTypes?.has(primaryEvidence.sourceType)) {
      throw new Error(
        `${id} classification ${contract.classification} requires source type ${[
          ...(permittedSourceTypes ?? []),
        ].join(" or ")}`,
      );
    }
    if (
      contract.supportingEvidence !== undefined &&
      !Array.isArray(contract.supportingEvidence)
    ) {
      throw new Error(`${id} supportingEvidence must be an array`);
    }
    for (const [index, rawReference] of (
      contract.supportingEvidence ?? []
    ).entries()) {
      validateContractEvidence(
        requireObject(rawReference, `${id} supportingEvidence ${index}`),
        `${id} supportingEvidence ${index}`,
      );
    }

    for (const field of ["owner", "protocolOwner", "styleOwner"]) {
      const value = contract[field];
      if (value) repositoryFile(root, value, `${id} ${field}`);
    }
    for (const testPath of contract.tests ?? []) {
      repositoryFile(root, testPath, `${id} test`);
    }
    if (contract.integrationRunner) {
      repositoryFile(
        root,
        contract.integrationRunner,
        `${id} integrationRunner`,
      );
    }
  }

  validateExtractedAvatarOwner(root, artifactsByPath);

  const productionFiles = options.productionFiles ?? [
    ...new Set(
      (options.productionRoots ?? DEFAULT_PRODUCTION_ROOTS).flatMap((directory) =>
        collectProductionFiles(root, directory),
      ),
    ),
  ];
  for (const file of productionFiles) {
    const sourcePath = repositoryFile(root, file, "Room UI production file");
    const source = readFileSync(sourcePath, "utf8");
    if (
      /(?:\bfrom|\bimport\s*\(|\brequire\s*\(|@import)\s*["'][^"']*(?:rah_os|raft-ui|raft_ui)/u.test(
        source,
      )
    ) {
      throw new Error(`${file} imports an external reference checkout`);
    }
  }
  const dependencyPolicyFiles =
    options.dependencyPolicyFiles ?? DEFAULT_DEPENDENCY_POLICY_FILES;
  for (const file of dependencyPolicyFiles) {
    const candidate = path.resolve(root, file);
    if (!existsSync(candidate)) continue;
    const sourcePath = repositoryFile(root, file, "Room UI dependency policy file");
    if (EXTERNAL_REFERENCE_PATTERN.test(readFileSync(sourcePath, "utf8"))) {
      throw new Error(`${file} configures an external reference checkout`);
    }
  }
  for (const assetRoot of options.assetRoots ?? DEFAULT_ASSET_ROOTS) {
    validateOwnedAssetTree(root, assetRoot);
  }
  return {
    artifactCount: artifactsByPath.size,
    contractCount: registry.contracts.length,
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  const result = validateRoomUiContract();
  console.log(
    `Room UI contract passed: ${result.contractCount} registered contracts, ${result.artifactCount} verified evidence artifacts.`,
  );
}
