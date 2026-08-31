import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  X509Certificate,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, join } from "node:path";

const CERTIFICATE_MAXIMUM_BYTES = 1024 * 1024;
const CA_VALIDITY_DAYS = 3_650;
const LEAF_VALIDITY_DAYS = 397;
const MINIMUM_REMAINING_VALIDITY_MS = 30 * 24 * 60 * 60_000;

export type ProvisionedLanCertificate = {
  caCertificatePath: string;
  caFingerprint256: string;
  caPrivateKeyPath: string;
  certificateFingerprint256: string;
  certificatePath: string;
  privateKeyPath: string;
  publicHostname: string;
  reused: boolean;
  validTo: string;
};

export function inspectLanCertificate(input: {
  directory: string;
  now?: number;
  publicHostname: string;
}): ProvisionedLanCertificate | undefined {
  if (!isAbsolute(input.directory)) {
    throw new Error("LAN certificate directory must be absolute");
  }
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now))
    throw new Error("LAN certificate clock is invalid");
  const publicHostname = normalizeHostname(input.publicHostname);
  if (!existsSync(input.directory)) return undefined;
  assertPrivateDirectory(input.directory);

  const caCertificatePath = join(input.directory, "local-ca.crt");
  const caPrivateKeyPath = join(input.directory, "local-ca.key");
  const authority = readCertificateAuthority({
    certificatePath: caCertificatePath,
    now,
    privateKeyPath: caPrivateKeyPath,
  });
  if (authority === undefined) return undefined;

  const hostsDirectory = join(input.directory, "hosts");
  if (!existsSync(hostsDirectory)) return undefined;
  assertPrivateDirectory(hostsDirectory);
  const identityDirectory = join(
    hostsDirectory,
    createHash("sha256").update(publicHostname).digest("hex").slice(0, 32),
  );
  if (!existsSync(identityDirectory)) return undefined;
  assertPrivateDirectory(identityDirectory);
  const certificatePath = join(identityDirectory, "tls.crt");
  const privateKeyPath = join(identityDirectory, "tls.key");
  const identity = readExistingIdentity({
    authority: authority.certificate,
    certificatePath,
    now,
    privateKeyPath,
    publicHostname,
    requireCurrent: true,
  });
  if (identity === undefined) return undefined;
  return result({
    authority: authority.certificate,
    caCertificatePath,
    caPrivateKeyPath,
    certificate: identity.certificate,
    certificatePath,
    privateKeyPath,
    publicHostname,
    reused: true,
  });
}

export function provisionLanCertificate(input: {
  directory: string;
  now?: number;
  opensslPath?: string;
  publicHostname: string;
}): ProvisionedLanCertificate {
  if (!isAbsolute(input.directory)) {
    throw new Error("LAN certificate directory must be absolute");
  }
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now))
    throw new Error("LAN certificate clock is invalid");
  const publicHostname = normalizeHostname(input.publicHostname);
  const opensslPath = input.opensslPath ?? "/usr/bin/openssl";
  if (!isAbsolute(opensslPath)) {
    throw new Error("LAN certificate openssl path must be absolute");
  }

  ensurePrivateDirectory(input.directory);
  const caCertificatePath = join(input.directory, "local-ca.crt");
  const caPrivateKeyPath = join(input.directory, "local-ca.key");
  const authority = ensureCertificateAuthority({
    certificatePath: caCertificatePath,
    directory: input.directory,
    now,
    opensslPath,
    privateKeyPath: caPrivateKeyPath,
  });

  const hostsDirectory = join(input.directory, "hosts");
  ensurePrivateDirectory(hostsDirectory);
  const identityDirectory = join(
    hostsDirectory,
    createHash("sha256").update(publicHostname).digest("hex").slice(0, 32),
  );
  ensurePrivateDirectory(identityDirectory);
  const certificatePath = join(identityDirectory, "tls.crt");
  const privateKeyPath = join(identityDirectory, "tls.key");
  const existing = readExistingIdentity({
    authority: authority.certificate,
    certificatePath,
    now,
    privateKeyPath,
    publicHostname,
    requireCurrent: false,
  });
  if (
    existing !== undefined &&
    existing.validTo - now >= MINIMUM_REMAINING_VALIDITY_MS
  ) {
    return result({
      authority: authority.certificate,
      caCertificatePath,
      caPrivateKeyPath,
      certificate: existing.certificate,
      certificatePath,
      privateKeyPath,
      publicHostname,
      reused: true,
    });
  }

  const temporaryDirectory = mkdtempSync(
    join(identityDirectory, ".provision-"),
  );
  try {
    const generatedCertificatePath = join(temporaryDirectory, "tls.crt");
    const generatedKeyPath = join(temporaryDirectory, "tls.key");
    const requestPath = join(temporaryDirectory, "tls.csr");
    const extensionsPath = join(temporaryDirectory, "tls.ext");
    writeFileSync(
      extensionsPath,
      [
        "basicConstraints=critical,CA:FALSE",
        "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth",
        `subjectAltName=${isIP(publicHostname) === 0 ? "DNS" : "IP"}:${publicHostname}`,
        "authorityKeyIdentifier=keyid,issuer",
        "subjectKeyIdentifier=hash",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    runOpenSsl(opensslPath, [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-keyout",
      generatedKeyPath,
      "-out",
      requestPath,
      "-subj",
      `/CN=${publicHostname}`,
    ]);
    runOpenSsl(opensslPath, [
      "x509",
      "-req",
      "-in",
      requestPath,
      "-CA",
      caCertificatePath,
      "-CAkey",
      caPrivateKeyPath,
      "-set_serial",
      `0x${randomBytes(16).toString("hex")}`,
      "-out",
      generatedCertificatePath,
      "-days",
      String(LEAF_VALIDITY_DAYS),
      "-sha256",
      "-extfile",
      extensionsPath,
    ]);
    chmodSync(generatedKeyPath, 0o600);
    chmodSync(generatedCertificatePath, 0o644);
    const generated = inspectIdentity({
      authority: authority.certificate,
      certificate: readBoundedCertificate(generatedCertificatePath),
      now: Math.max(now, Date.now()),
      privateKey: readPrivateKey(generatedKeyPath, "LAN private key"),
      publicHostname,
    });
    durableFile(generatedKeyPath);
    durableFile(generatedCertificatePath);
    renameSync(generatedKeyPath, privateKeyPath);
    renameSync(generatedCertificatePath, certificatePath);
    durableDirectory(identityDirectory);
    return result({
      authority: authority.certificate,
      caCertificatePath,
      caPrivateKeyPath,
      certificate: generated.certificate,
      certificatePath,
      privateKeyPath,
      publicHostname,
      reused: false,
    });
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function ensureCertificateAuthority(input: {
  certificatePath: string;
  directory: string;
  now: number;
  opensslPath: string;
  privateKeyPath: string;
}): { certificate: X509Certificate } {
  const existing = readCertificateAuthority(input);
  if (existing !== undefined) return existing;

  const temporaryDirectory = mkdtempSync(join(input.directory, ".ca-"));
  try {
    const generatedCertificatePath = join(temporaryDirectory, "local-ca.crt");
    const generatedKeyPath = join(temporaryDirectory, "local-ca.key");
    runOpenSsl(input.opensslPath, [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-keyout",
      generatedKeyPath,
      "-out",
      generatedCertificatePath,
      "-days",
      String(CA_VALIDITY_DAYS),
      "-subj",
      "/CN=RAH OS Local CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
      "-addext",
      "subjectKeyIdentifier=hash",
    ]);
    chmodSync(generatedKeyPath, 0o600);
    chmodSync(generatedCertificatePath, 0o644);
    const certificate = new X509Certificate(
      readBoundedCertificate(generatedCertificatePath),
    );
    if (!certificate.ca)
      throw new Error("generated LAN certificate is not a CA");
    assertCertificateTime(
      certificate,
      Math.max(input.now, Date.now()),
      "generated LAN CA",
    );
    assertMatchingKey(
      certificate,
      readPrivateKey(generatedKeyPath, "generated LAN CA private key"),
      "generated LAN CA private key",
    );
    durableFile(generatedKeyPath);
    durableFile(generatedCertificatePath);
    renameSync(generatedKeyPath, input.privateKeyPath);
    renameSync(generatedCertificatePath, input.certificatePath);
    durableDirectory(input.directory);
    return { certificate };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function readCertificateAuthority(input: {
  certificatePath: string;
  now: number;
  privateKeyPath: string;
}): { certificate: X509Certificate } | undefined {
  const certificateExists = existsSync(input.certificatePath);
  const keyExists = existsSync(input.privateKeyPath);
  if (certificateExists !== keyExists) {
    throw new Error("LAN local CA identity is incomplete");
  }
  if (!certificateExists) return undefined;
  const certificate = new X509Certificate(
    readBoundedCertificate(input.certificatePath),
  );
  if (!certificate.ca) throw new Error("LAN local CA certificate is not a CA");
  assertCertificateTime(certificate, input.now, "LAN local CA certificate");
  const privateKey = readPrivateKey(input.privateKeyPath, "LAN CA private key");
  assertMatchingKey(certificate, privateKey, "LAN local CA private key");
  return { certificate };
}

function readExistingIdentity(input: {
  authority: X509Certificate;
  certificatePath: string;
  now: number;
  privateKeyPath: string;
  publicHostname: string;
  requireCurrent: boolean;
}): { certificate: X509Certificate; validTo: number } | undefined {
  const certificateExists = existsSync(input.certificatePath);
  const keyExists = existsSync(input.privateKeyPath);
  if (certificateExists !== keyExists) {
    throw new Error("LAN TLS identity is incomplete");
  }
  if (!certificateExists) return undefined;
  return inspectIdentity({
    authority: input.authority,
    certificate: readBoundedCertificate(input.certificatePath),
    now: input.now,
    privateKey: readPrivateKey(input.privateKeyPath, "LAN private key"),
    publicHostname: input.publicHostname,
    requireCurrent: input.requireCurrent,
  });
}

function inspectIdentity(input: {
  authority: X509Certificate;
  certificate: Buffer;
  now: number;
  privateKey: Buffer;
  publicHostname: string;
  requireCurrent?: boolean;
}): { certificate: X509Certificate; validTo: number } {
  const certificate = new X509Certificate(input.certificate);
  const { validFrom, validTo } = certificateTimes(certificate);
  if (
    input.requireCurrent !== false &&
    (input.now < validFrom || input.now > validTo)
  ) {
    throw new Error("LAN TLS certificate is not currently valid");
  }
  const covered =
    isIP(input.publicHostname) === 0
      ? certificate.checkHost(input.publicHostname)
      : certificate.checkIP(input.publicHostname);
  if (covered === undefined) {
    throw new Error("LAN TLS certificate does not cover the public hostname");
  }
  assertMatchingKey(certificate, input.privateKey, "LAN private key");
  if (
    !certificate.checkIssued(input.authority) ||
    !certificate.verify(input.authority.publicKey)
  ) {
    throw new Error("LAN TLS certificate was not issued by the local CA");
  }
  return { certificate, validTo };
}

function result(input: {
  authority: X509Certificate;
  caCertificatePath: string;
  caPrivateKeyPath: string;
  certificate: X509Certificate;
  certificatePath: string;
  privateKeyPath: string;
  publicHostname: string;
  reused: boolean;
}): ProvisionedLanCertificate {
  return {
    caCertificatePath: input.caCertificatePath,
    caFingerprint256: input.authority.fingerprint256,
    caPrivateKeyPath: input.caPrivateKeyPath,
    certificateFingerprint256: input.certificate.fingerprint256,
    certificatePath: input.certificatePath,
    privateKeyPath: input.privateKeyPath,
    publicHostname: input.publicHostname,
    reused: input.reused,
    validTo: new Date(input.certificate.validTo).toISOString(),
  };
}

function normalizeHostname(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\s/?#@=]/u.test(trimmed)) {
    throw new Error("LAN public hostname is invalid");
  }
  if (isIP(trimmed) !== 0) return trimmed;
  const parsed = new URL(`https://${trimmed}`);
  if (parsed.port !== "" || parsed.pathname !== "/") {
    throw new Error("LAN public hostname must not include a port or path");
  }
  return parsed.hostname;
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { mode: 0o700, recursive: true });
  assertPrivateDirectory(path);
}

function assertPrivateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${path} must be a private directory`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} must be owner-private`);
  }
}

function readBoundedCertificate(path: string): Buffer {
  const metadata = lstatSync(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > CERTIFICATE_MAXIMUM_BYTES
  ) {
    throw new Error(`${path} must be a bounded regular certificate file`);
  }
  return readFileSync(path);
}

function readPrivateKey(path: string, label: string): Buffer {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must be owner-private`);
  }
  if (metadata.size < 1 || metadata.size > CERTIFICATE_MAXIMUM_BYTES) {
    throw new Error(`${label} has an invalid size`);
  }
  return readFileSync(path);
}

function assertCertificateTime(
  certificate: X509Certificate,
  now: number,
  label: string,
): number {
  const { validFrom, validTo } = certificateTimes(certificate);
  if (now < validFrom || now > validTo) {
    throw new Error(`${label} is not currently valid`);
  }
  return validTo;
}

function certificateTimes(certificate: X509Certificate): {
  validFrom: number;
  validTo: number;
} {
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo)) {
    throw new Error("LAN certificate validity is malformed");
  }
  return { validFrom, validTo };
}

function assertMatchingKey(
  certificate: X509Certificate,
  privateKey: Buffer,
  label: string,
): void {
  let suppliedPublicKey: Buffer;
  try {
    suppliedPublicKey = createPublicKey(createPrivateKey(privateKey)).export({
      format: "der",
      type: "spki",
    });
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const certificatePublicKey = certificate.publicKey.export({
    format: "der",
    type: "spki",
  });
  if (!certificatePublicKey.equals(suppliedPublicKey)) {
    throw new Error(`${label} does not match its certificate`);
  }
}

function runOpenSsl(path: string, arguments_: string[]): void {
  try {
    execFileSync(path, arguments_, {
      env: { PATH: "/usr/bin:/bin" },
      maxBuffer: 64 * 1_024,
      stdio: "ignore",
      timeout: 30_000,
    });
  } catch {
    throw new Error("LAN certificate generation failed");
  }
}

function durableFile(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function durableDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
