# Dependency maintenance

Use the committed lockfile and a patched Node.js build: **22.23.4 or newer in 22.x**, or **24.22.1 or newer in 24.x**. CI pins Node **22.23.4**. The package's `engines` and npm `devEngines.runtime` declare these supported ranges; `devEngines` fails npm install, ci and run commands on an unsupported runtime. The Windows build helper also checks the version before installing dependencies. These are build-tool requirements, not the Node version bundled inside Electron.

Supported Windows builds and CI install with `npm ci --omit=optional`. Runtime libraries and development/build tools are both covered by the supported-build audit. Optional packages remain in the lockfile and receive a separate complete-lockfile audit; omission alone does not resolve an advisory.

```powershell
npm ci --omit=optional
node scripts/Verify-Publication.cjs --installed
npm audit --package-lock-only --omit=optional --ignore-scripts --audit-level=low
npm audit --package-lock-only --ignore-scripts --audit-level=low
```

`Verify-Publication.cjs` checks that optional lockfile placements are actually absent. The [full SPDX inventory](SBOM.spdx.json) includes the locked build graph. The [runtime SPDX inventory](SBOM-runtime.spdx.json) and [third-party notices](THIRD-PARTY-NOTICES.md) describe the packaged JavaScript subset; Electron/Chromium distribute their own notices beside the executable.

## November 7, 2026 maintenance for 1.2.9

Electron is updated from **44.10.0 to 44.10.2**, the current maintenance release on the supported 44.x line. Its [official release notes](https://releases.electronjs.org/release/v44.10.2) identify Node **24.22.2**, Chromium **152.0.7977.169**, and backported fixes from ANGLE, Chromium, libaom, libvpx, PDFium, Skia, V8 and WebRTC. The preceding [44.10.1 release](https://releases.electronjs.org/release/v44.10.1) also carries Chromium/Dawn/Skia/V8 fixes and `net.fetch()` improvements. Electron 45.2.3 is the newer major line; this maintenance update retains 44.x to limit compatibility changes.

The baseline lockfile audit reported **eight moderate dependency entries from two underlying advisories**, in both the supported and complete graphs. There were no high or critical entries. These packages are development/build dependencies, not part of the packaged JavaScript runtime:

| Advisory | Affected locked packages | Repair |
| --- | --- | --- |
| [CVE-2026-118773 / GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | glob 13.0.6, beneath direct @electron/asar 4.3.1 | Override only glob versions `>=9.0.0 <14.0.2` to 14.0.4 |
| [CVE-2026-118764 / GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch 10.2.6 and 9.0.9, used by ASAR and builder tooling | Override only minimatch versions `>=7.0.0 <11.0.1` to 11.0.5 |

The glob issue continues filesystem I/O after an asynchronous walk is cancelled; it is an availability issue, not a demonstrated escape from a filesystem root. The minimatch issue amplifies attacker-controlled patterns when `optimizationLevel >= 2`, consuming CPU and memory. NerdSSHell's build tooling uses repository-controlled patterns; this review did not establish an attack through an SSH connection. Updating the build graph removes the vulnerable packages rather than suppressing the advisories.

The fixes cross the dependency consumers' declared major-version ranges. `test/build-dependencies.test.cjs` therefore exercises the installed ASAR and electron-builder APIs, application inclusion/exclusion and unpack patterns, Windows path matching, hostile pattern handling and cancellation. Keep those checks when refreshing the overrides. The version qualifiers deliberately leave glob 7 and minimatch 3/5 consumers alone; those older APIs are outside these two advisory ranges. The scoped global-agent override described below remains necessary. Remove an override only after its upstream consumer adopts a patched compatible dependency and the same tests pass.

The other direct npm dependencies remain at their reviewed current versions: @xterm/xterm 6.0.0, addon-fit 0.11.0, addon-search 0.16.0, ssh2 1.17.0, node-pty 1.2.0-beta.18, @electron/asar 4.3.1, @electron/fuses 2.1.3, electron-builder 26.18.1 and resedit 3.1.0. The deliberate node-pty beta pin and native-provider hashes remain unchanged. Pillow 13.0.0, used only for optional branding generation, is current and has no known advisory in the November 7 requirements audit.

The [CodeQL Action 4.39.3 release](https://github.com/github/codeql-action/releases/tag/v4.39.3) fixes diff-based alert filtering for paths containing spaces, special characters or non-ASCII characters; both workflow uses are pinned to its official commit `33d7b85da1a04171e211befe2c739303b9a4c066`. Checkout 7.0.1, setup-node 7.1.0 and upload-artifact 7.0.2 remain their current releases. Changing an Action pin does not establish that the workflow ran; actual local checks and any outstanding protected checks are recorded in [validation results](VALIDATION.md).

### Announced upstream follow-up

Node has [announced security releases for November 11, 2026](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases), with high-severity issues affecting the supported 22.x, 24.x and 26.x lines. Those fixes are not released as of this review. Reassess both the source-build Node minimum/CI pin and Electron's embedded Node after upstream publishes the fixes. Installing a newer standalone Node does not update the Node runtime inside an Electron application. This release does not claim to include the pending fixes or establish their eventual application-specific reachability.

## October 28, 2026 maintenance for 1.2.8

The updated dependency set is Electron **44.10.0**, node-pty **1.2.0-beta.18**, and electron-builder **26.18.1**. Other direct runtime/build libraries and the optional Pillow 13.0.0 branding tool remain at their current stable releases. CI continues to use the current patched Node 22.23.4 release; Node 24.22.2 is also accepted by the existing 24.22.1-or-newer source-build range.

[Electron 44.10.0](https://releases.electronjs.org/release/v44.10.0) includes **Node 24.22.1** and **Chromium 152.0.7977.169**. This resolves the embedded-Node version gap recorded below for 1.2.6/1.2.7. The upstream runtime now incorporates the [October Node security release](https://nodejs.org/en/blog/release/v24.22.1), including the Brotli decoder fix. This does not imply that every upstream vulnerability was reachable through NerdSSHell. The same Electron update fixes malformed ASAR handling, archive-path inconsistencies and File System Access blocklist gaps. Staying on supported Electron 44.x keeps this a maintenance update; Electron 45 is not required to obtain these fixes.

The official [electron-builder 26.18.1 release](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder@26.18.1) is the stable v26 maintenance channel, even though npm's default latest tag still selects 26.18.0 at this review. The update includes ASAR source/destination containment and NSIS extraction compatibility fixes, so both exact-package verification and real disposable Windows installer acceptance are required. Its internal ASAR 3.4.1 and downloader 3.1.0 remain; retain the scoped proxy override and verify the complete graph.

The reviewed, registry-integrity-verified node-pty beta.18 package hardens closed ConPTY handle operations and adds an optional reparent API that NerdSSHell does not call. The shipped `conpty.node` SHA-256 is `4d2112f9316c9927145e821f20d470369c7ac8ffe63e981fb62a57c303f7f488`. Its ConPTY 1.25.260303002 DLL and OpenConsole executable are byte-identical to beta.15, preserving the elevated helper's existing binary pins. The owned worker cleanup adapter remains necessary and unchanged. Test ordinary and administrator PowerShell/CMD, shutdown and packaging against the new native module.

GitHub Actions use reviewed full-SHA pins for setup-node 7.1.0, upload-artifact 7.0.2 and CodeQL 4.39.1; checkout remains 7.0.1. Required checks, fork/owner restrictions, tag protection and read-only default tokens remain enforced. See [validation results](VALIDATION.md) for measured tests and their platform limits.

## Optional build-proxy override

`electron-builder 26.18.1 -> app-builder-lib 26.18.1 -> @electron/get 3.1.0` introduces the optional HTTP(S) build-download proxy. Its original `global-agent 3.0.0 -> roarr 2.15.4 -> sprintf-js 1.1.3` chain contains [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The affected formatter has no patched release. It is not included in the packaged application or supported installation.

The scoped `package.json` override selects **global-agent 4.1.3** only beneath `app-builder-lib`'s `@electron/get`. [Upstream 4.1.0](https://github.com/gajus/global-agent/releases/tag/v4.1.0) removes `roarr`; its formatter and unused helper dependencies consequently leave the lockfile. Electron's separate downloader, runtime SSH/terminal libraries and packaging versions remain pinned independently. No advisory is suppressed or dismissed.

The required CommonJS `bootstrap()` export, `GLOBAL_AGENT_*` environment settings and mutable `NO_PROXY` controller remain compatible with [@electron/get 3.1.0's proxy integration](https://github.com/electron/get/blob/v3.1.0/src/proxy.ts). Version 4's TypeScript migration does not affect this JavaScript caller. Its default TLS certificate verification remains enabled; do not disable verification to accommodate a proxy.

Verify this optional path with a complete dependency install in a disposable directory. Lifecycle scripts are unnecessary for the proxy fixture:

```powershell
$fixture = Join-Path $env:TEMP ('NerdSSHell-build-proxy-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixture | Out-Null
Copy-Item package.json,package-lock.json -Destination $fixture
npm ci --ignore-scripts --prefix $fixture
if ($LASTEXITCODE -ne 0) { throw 'Disposable dependency installation failed.' }
node scripts/Verify-Build-Proxy.cjs $fixture
if ($LASTEXITCODE -ne 0) { throw 'Build-proxy compatibility verification failed.' }
```

The fixture uses loopback endpoints and synthetic bytes. It verifies actual downloader bootstrap, proxy forwarding, checksum rejection, cache reuse, `NO_PROXY` bypass and absence of `roarr`/`sprintf-js`. Recheck it when changing the override or downloader. Remove the override when a tested upstream builder release selects a dependency graph without the affected formatter.

## October 25, 2026 security maintenance

The previous source revision still selected Electron 44.5.1. Its complete npm audit reported three affected packages: Electron (high), Undici (high) and fast-uri (moderate). The following updates retain the existing Electron and transitive npm major versions, with no advisory suppression or forced incompatible overrides:

| Component | Previous | Updated | Scope and advisory evidence |
| --- | --- | --- | --- |
| Electron | 44.5.1 | 44.9.3 | The packaged runtime; includes the compromised eMudhra intermediate-certificate mitigation, [GHSA-jr5w-w6x2-84p9 / CVE-2026-115570](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9), fixed in 44.9.1. |
| fast-uri | 3.1.8 | 3.1.9 | Build-time `app-builder-lib -> ajv` dependency; [3.1.9](https://github.com/fastify/fast-uri/releases/tag/v3.1.9) fixes scheme spoofing, host confusion and reference-normalization advisories. |
| Undici 6 | 6.29.0 | 6.29.1 | Build-time `@electron/rebuild -> node-gyp` dependency; [6.29.1](https://github.com/nodejs/undici/releases/tag/v6.29.1) fixes EventSource memory exhaustion and excessive-content-encoding crashes. |
| Undici 7 | 7.30.0 | 7.30.1 | Optional `@electron/get` build-downloader dependency; [7.30.1](https://github.com/nodejs/undici/releases/tag/v7.30.1) also fixes subresource-integrity token handling. |
| Pillow | 12.3.0 | 13.0.0 | Optional branding-generation tool, not shipped in the application. [13.0.0](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html) fixes image-processing vulnerabilities and requires Python 3.11 or newer. |

The supported and complete npm lockfile audits both report zero advisories after these updates. This describes the npm advisory database at the time of the audit; it does not certify every binary dependency or future vulnerability. No PHP source, Composer manifest, PHP runtime or PHP deployment service is present in this repository, so the recent PHP server advisories do not require a NerdSSHell PHP update.

### Historical embedded Node gap in 1.2.6 and 1.2.7

The following assessment records the October 25 dependency state. Version 1.2.8 resolves the embedded version gap with Electron 44.10.0 as described above; these older releases retain their original runtime.

The [October 21 Node.js security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) are 22.23.4, 24.22.1 and 26.12.1. Updating the build machine or npm's Undici packages does not replace Electron's embedded Node. [Electron 44.9.3](https://releases.electronjs.org/release/v44.9.3) contains Chromium 152.0.7977.167 and **Node 24.22.0**, below that security release. The current stable Electron 45.0.0 also reports Node 24.22.0; an alpha is not used as a production substitute.

Source review of this revision found these boundaries:

- Production update requests use `src/main.cjs`'s `createReleaseFetch(net)` and `src/release-transport.cjs`'s Chromium `net.request`, with fixed/allowlisted HTTPS hosts and omitted credentials. The other Electron `net.fetch` serves allowlisted local files. Neither is Node's built-in fetch or HTTP Agent.
- SSH uses `ssh2` over TCP with its own host-key verification. Saved and temporary hostnames reject NUL/control characters and non-ASCII DNS names. The inspected SSH path uses `dns.lookup`, not the affected `dns.resolve*`/`reverse` APIs.
- No production Node Brotli decoder, EventSource, user-built Node startup snapshot/SEA, or Node Permission Model configuration was found. SSH compression is DEFLATE/INFLATE. UUIDs are generated at runtime without a user-built snapshot.
- Build/release tooling does use Node's built-in fetch, so the separate build Node security floor is necessary even with a clean npm graph.

These observations identify no production route to the enumerated Node-specific triggers; they are a limited reachability assessment, **not proof that the embedded runtime is patched or that all inherited native-library issues are unreachable**. The app uses Node/OpenSSL crypto through SSH, and Electron has its own Chromium/native dependencies. Keep the embedded Node update open until a supported stable Electron release includes the security fixes, then rebuild and repeat the exact Windows acceptance checks. Do not describe 1.2.6 as resolving every October 21 Node vulnerability.

## Build-tool deprecation warnings

The pinned builder still introduces `glob 7.2.3`/`inflight 1.0.6` through its `@electron/asar 3.4.1`, and `rimraf 2.6.3` through `temp 0.9.4`. npm reports deprecation warnings for these packages. They are build-only and are excluded from the packaged runtime; audit their exact locked versions separately from deprecation status. Prefer an upstream builder update over forcing incompatible glob/ASAR majors into its internal API.
