# Node runtime and hot upgrade

Loom pins Node.js 26.13.1 (Lithium). Node 26 first shipped on 2026-05-05, entered Active LTS on 2026-10-28, enters maintenance on 2027-10-20, and reaches end of support on 2029-04-30. The 26.13.1 security release was announced on 2026-11-11. The distribution index records its release date as 2026-11-10. [Node.js Releases](https://nodejs.org/en/about/previous-releases#release-schedule) · [Release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) · [Release announcement and signed checksums](https://nodejs.org/en/blog/release/v26.13.1#shasums) · [Distribution index](https://nodejs.org/dist/index.json)

From a clean release checkout, prepare the runtime and the build:

```sh
./bin/install-node
./bin/build-release
```

`bin/node-runtime` stores the exact version and the official archive SHA-256 values. `install-node` downloads the corresponding `.tar.xz` and `SHASUMS256.txt` over HTTPS, compares the selected entry with the pinned digest, verifies the archive, and installs it under `~/.loom-cell/runtime/node-<version>/`. macOS arm64 uses `darwin-arm64` and Linux x64 uses `linux-x64`. To check the manifest signature independently, verify `SHASUMS256.txt.sig` against `SHASUMS256.txt` with an isolated keyring containing the release signer's Node.js public key. The signer for this pin is `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`. [Node.js release signing keys](https://github.com/nodejs/release-keys)

`build-release` runs the bundled npm under the pinned executable, rebuilds `node-pty` with that distribution's headers, and runs the fixture smoke tests. The fixture starts a daemon and a mock native CLI, sends input, tests recovery after a failed handoff and verifies a successful hot upgrade with the same native binding. The build needs a Python 3 interpreter, `make`, and a C/C++ toolchain. The runtime and build commands use process-local environments. For a standalone evaluation or test script, use `./bin/loom-node path/to/script.mjs …`. Managed workers receive the absolute executable in `LOOM_NODE`.

For a running project, send the upgrade through the existing writer:

```sh
./bin/loom upgrade --project /absolute/project --to /absolute/candidate --check
./bin/loom upgrade --project /absolute/project --to /absolute/candidate
./bin/loom upgrade --status --project /absolute/project
./bin/loom doctor --project /absolute/project
```

Preflight uses the candidate runtime and reports its path, version and native ABI as `target.nodeRuntime`. A pre-pin daemon can invoke the candidate with its original Node. The candidate entry replaces that process in place with the pinned executable, so the old upgrade launcher still sees the same PID. During this compatibility probe, `node` holds the requesting process's version and `nodeRuntime` holds the actual candidate runtime. On commit the release pointer records runtime identities, and the managed `LOOM_BIN` launcher follows the serving daemon. Doctor reports the installed pin and the CLI and daemon runtime identities under `report.nodeRuntime`.

The hot upgrade reattaches live holders and session hosts. Retained sessions keep their original runtime and hook entry arguments. Keep the old release, its dependencies and its Node executable available until those sessions drain, and while rollback is available. `loom upgrade --rollback` selects the recorded previous runtime when rolling back across the pin boundary.
