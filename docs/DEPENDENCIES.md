# Dependency maintenance

Use the committed lockfile and Node.js **22.12.0 or newer**. Supported Windows builds and CI install with `npm ci --omit=optional`. Runtime libraries and development/build tools are both covered by the supported-build audit. Optional packages remain in the lockfile and receive a separate complete-lockfile audit; omission alone does not resolve an advisory.

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

## Build-tool deprecation warnings

The pinned builder still introduces `glob 7.2.3`/`inflight 1.0.6` through its `@electron/asar 3.4.1`, and `rimraf 2.6.3` through `temp 0.9.4`. npm reports deprecation warnings for these packages. They are build-only and are excluded from the packaged runtime; audit their exact locked versions separately from deprecation status. Prefer an upstream builder update over forcing incompatible glob/ASAR majors into its internal API.
