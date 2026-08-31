import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectLanCertificate,
  provisionLanCertificate,
} from "../src/lan-certificate-provisioning.ts";

test("LAN certificate provisioning creates and reuses one private local CA", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-lan-tls-"));
  try {
    const unprovisionedDirectory = join(directory, "not-created");
    assert.equal(
      inspectLanCertificate({
        directory: unprovisionedDirectory,
        publicHostname: "127.0.0.1",
      }),
      undefined,
    );
    assert.throws(
      () => lstatSync(unprovisionedDirectory),
      /ENOENT/u,
      "inspection must remain read-only",
    );
    const first = provisionLanCertificate({
      directory,
      publicHostname: "127.0.0.1",
    });
    const leaf = new X509Certificate(readFileSync(first.certificatePath));
    const authority = new X509Certificate(
      readFileSync(first.caCertificatePath),
    );

    assert.equal(first.reused, false);
    assert.equal(leaf.checkIP("127.0.0.1"), "127.0.0.1");
    assert.equal(authority.ca, true);
    assert.equal(leaf.checkIssued(authority), true);
    assert.equal(
      lstatSync(first.privateKeyPath).mode & 0o077,
      0,
      "the leaf private key must be owner-private",
    );
    assert.equal(
      lstatSync(first.caPrivateKeyPath).mode & 0o077,
      0,
      "the CA private key must be owner-private",
    );
    assert.equal(
      inspectLanCertificate({
        directory,
        publicHostname: "127.0.0.1",
      })?.certificateFingerprint256,
      first.certificateFingerprint256,
    );

    const repeated = provisionLanCertificate({
      directory,
      publicHostname: "127.0.0.1",
    });
    assert.equal(repeated.reused, true);
    assert.equal(
      repeated.certificateFingerprint256,
      first.certificateFingerprint256,
    );
    assert.equal(repeated.caFingerprint256, first.caFingerprint256);

    const renewed = provisionLanCertificate({
      directory,
      now: Date.parse(leaf.validTo) - 29 * 24 * 60 * 60_000,
      publicHostname: "127.0.0.1",
    });
    assert.equal(renewed.reused, false);
    assert.notEqual(
      renewed.certificateFingerprint256,
      first.certificateFingerprint256,
    );
    assert.equal(renewed.caFingerprint256, first.caFingerprint256);

    const dnsIdentity = provisionLanCertificate({
      directory,
      publicHostname: "rah-core.local",
    });
    const dnsLeaf = new X509Certificate(
      readFileSync(dnsIdentity.certificatePath),
    );
    assert.equal(dnsLeaf.checkHost("rah-core.local"), "rah-core.local");
    assert.equal(dnsIdentity.caFingerprint256, first.caFingerprint256);
    assert.notEqual(
      dnsIdentity.certificateFingerprint256,
      first.certificateFingerprint256,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("LAN certificate provisioning fails closed on an exposed private root", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-lan-tls-"));
  try {
    const first = provisionLanCertificate({
      directory,
      publicHostname: "127.0.0.1",
    });
    const mode = lstatSync(first.caPrivateKeyPath).mode;
    // Deliberately expose the root key to the group; the next inspection must
    // fail instead of silently repairing an ambiguous security boundary.
    chmodSync(first.caPrivateKeyPath, mode | 0o040);
    assert.throws(
      () =>
        provisionLanCertificate({
          directory,
          publicHostname: "127.0.0.1",
        }),
      /CA private key must be owner-private/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
