# Public CodeQL triage — October 6, 2026

CodeQL 2.27.1 actually analyzed JavaScript and Actions in the independent public repository. Initial main analyses at clean baseline `98f7baac6c85c069d3fee13c766b78f3a8c7b0f7` reported 43 JavaScript alerts and zero Actions results. Both analyses completed without errors. A successful workflow is not a zero-alert claim.

All 43 inputs were statically reviewed individually and retained in a per-input triage receipt outside tracked source. No scanner exclusion, alert dismissal or code-scanning suppression was applied.

| GitHub alert IDs | Rule | Cited surface | Static verdict and defeating evidence |
| --- | --- | --- | --- |
| 1 | `js/incomplete-sanitization` (high) | `test/session-commands.test.cjs:69` | Not actionable as a product vulnerability. A single newline replacement builds the expected value for an assertion over fixed developer-authored input. It is not a sanitization control or execution sink. |
| 2–43 | `js/bad-code-sanitization` (medium) | Native CMD/PowerShell/administrator, Scratchpad, Actions and SFTP acceptance scripts | Each not actionable as the cited product claim. JSON literals and trusted fixture expressions go to CDP `Runtime.evaluate` or Electron `executeJavaScript`, not an HTML `<script>` parser. Controlled fixture values/local keys are the source; no production server path into these harness entrypoints was established. |

The script alerts occur in `Packaged-LocalCmd-Smoke.cjs`, `Packaged-LocalPowerShell-Smoke.cjs`, `Packaged-Administrator-Smoke.cjs`, `Scratchpad-Wrap-Smoke.cjs`, `UX-Actions-Smoke.cjs` and `UX-SFTP-Smoke.cjs`. Duplicate-looking locations were retained as distinct findings in the receipt rather than silently dropped.

Package `build.files` ships `src/**`, `ui/**` and package metadata; these `scripts/` and `test/` locations are not shipped. The application resource allowlist cannot serve them. The developer-controlled packaged harness uses owned disposable profiles and loopback transports. SECURITY.md treats actual remote output as VT data rather than HTML; that production boundary was not shown to reach the cited harness code.

This is static triage for the supplied baseline claims, with high confidence in their non-product boundary. It includes no exploit or runtime validation and does not establish that the application has no other vulnerabilities. Existing genuine signing, clean-user/UAC/native acceptance and documented data/transfer limitations remain. Keep CodeQL and secret scanning enabled and review newly introduced findings on their actual revisions.
