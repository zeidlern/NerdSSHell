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

## Optional build-proxy override

`electron-builder 26.15.3 -> app-builder-lib 26.15.3 -> @electron/get 3.1.0` introduces the optional HTTP(S) build-download proxy. Its original `global-agent 3.0.0 -> roarr 2.15.4 -> sprintf-js 1.1.3` chain contains [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The affected formatter has no patched release. It is not included in the packaged application or supported installation.

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

### Embedded Node remains an upstream follow-up

The [October 21 Node.js security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) are 22.23.4, 24.22.1 and 26.12.1. Updating the build machine or npm's Undici packages does not replace Electron's embedded Node. [Electron 44.9.3](https://releases.electronjs.org/release/v44.9.3) contains Chromium 152.0.7977.167 and **Node 24.22.0**, below that security release. The current stable Electron 45.0.0 also reports Node 24.22.0; an alpha is not used as a production substitute.

Source review of this revision found these boundaries:

- Production update requests use `src/main.cjs`'s `createReleaseFetch(net)` and `src/release-transport.cjs`'s Chromium `net.request`, with fixed/allowlisted HTTPS hosts and omitted credentials. The other Electron `net.fetch` serves allowlisted local files. Neither is Node's built-in fetch or HTTP Agent.
- SSH uses `ssh2` over TCP with its own host-key verification. Saved and temporary hostnames reject NUL/control characters and non-ASCII DNS names. The inspected SSH path uses `dns.lookup`, not the affected `dns.resolve*`/`reverse` APIs.
- No production Node Brotli decoder, EventSource, user-built Node startup snapshot/SEA, or Node Permission Model configuration was found. SSH compression is DEFLATE/INFLATE. UUIDs are generated at runtime without a user-built snapshot.
- Build/release tooling does use Node's built-in fetch, so the separate build Node security floor is necessary even with a clean npm graph.

These observations identify no production route to the enumerated Node-specific triggers; they are a limited reachability assessment, **not proof that the embedded runtime is patched or that all inherited native-library issues are unreachable**. The app uses Node/OpenSSL crypto through SSH, and Electron has its own Chromium/native dependencies. Keep the embedded Node update open until a supported stable Electron release includes the security fixes, then rebuild and repeat the exact Windows acceptance checks. Do not describe 1.2.6 as resolving every October 21 Node vulnerability.

## Build-tool deprecation warnings

The pinned builder still introduces `glob 7.2.3`/`inflight 1.0.6` through its `@electron/asar 3.4.1`, and `rimraf 2.6.3` through `temp 0.9.4`. npm reports deprecation warnings for these packages. They are build-only and are excluded from the packaged runtime; audit their exact locked versions separately from deprecation status. Prefer an upstream builder update over forcing incompatible glob/ASAR majors into its internal API.
