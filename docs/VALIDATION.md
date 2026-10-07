# Version 1.0.2 validation

Validated October 7, 2026 against [code revision 0680e92](https://github.com/zeidlern/NerdSSHell/commit/0680e922b6183e356ab36d3b3930d05b7feb8369). Local checks ran on Windows x64 with Node.js 24.19.0; GitHub CI used Node.js 22 on Linux and Windows. These results apply to the identified source and artifacts.

## Results

| Check | Actual result |
| --- | --- |
| Source/publication checks | Passed JavaScript syntax, synchronized metadata, branding, UI references and 16 Wiki pages |
| Windows unit/native regressions | 774 passed locally and in CI; zero failures or skips |
| Linux regressions | 751 passed; zero failures or skips |
| Disposable real SSH/tmux integration | 8 passed; zero failures or skips |
| NSIS Windows x64 installer | Built successfully |
| Package verification | Identity/version, fuses, ASAR metadata, native hashes, containment and notices passed |
| Exact shipped source/UI comparison | All 74 files match the tested ASAR byte-for-byte |
| Packaged UI, SSH/SFTP and console acceptance | 164 local checks and 174 CI checks passed |
| Exact-ASAR native bridge without UAC | CMD, Windows PowerShell and PowerShell 7 provider/ownership/editing/cleanup checks passed |
| Native Scratchpad spelling/word wrap | 16 checks passed; no external dictionary/request URLs |
| Dependencies | Supported and complete lockfile audits: zero vulnerabilities; installed resolution passed |
| Documentation | 131 local targets in 38 Markdown files resolved |
| Workflows | actionlint 1.7.12 passed; required GitHub checks passed |
| CodeQL | JavaScript/TypeScript and Actions analyses passed |
| Secrets/privacy | Full reachable-history Gitleaks passed; no known credential exposure found |

The project uses JavaScript and does not configure a separate general-purpose linter or type checker. Those checks are **not configured**, rather than reported as passes. Syntax and workflow validation are separate checks.

CI evidence: [build and Windows acceptance](https://github.com/zeidlern/NerdSSHell/actions/runs/37577669608), [dependency/secret checks](https://github.com/zeidlern/NerdSSHell/actions/runs/37577669574), [CodeQL](https://github.com/zeidlern/NerdSSHell/actions/runs/37577669611).

## Security dispositions

The optional build-only `sprintf-js` advisory was removed through a scoped `global-agent` 4.1.3 update. The complete graph lost `roarr`, `sprintf-js` and unused logging helpers. No dependency alert was dismissed. Actual loopback tests verify proxy bootstrap/forwarding, cache, `NO_PROXY`, checksum rejection and refusal of non-origin or credential-bearing URLs. See [dependency maintenance](DEPENDENCIES.md).

Each of the 43 initial CodeQL alerts was reviewed individually: 42 were false positives for JSON literals sent directly to V8/CDP in isolated acceptance scripts, without an HTML parser sink; one was an expected-value expression in a fixed test. Each received its own documented dismissal. A new SSRF alert in the build-proxy fixture was corrected by constructing the forwarding destination only from its owned loopback endpoint; CodeQL reports it fixed. No scan query, test or shell behavior was suppressed.

Source review found and fixed two availability issues: aggregate discovered/open/pending terminal allocations and an abandoned SSH half-close socket. Tests cover bounded discovery, pending generations and renderer launch reservations, unchanged session identity, old-socket-only cleanup and a real hostile loopback peer. The review covered 138 runnable source/UI/tooling/test/workflow files; it is not an independent product certification.

At the reviewed code revision, Gitleaks covered seven reachable commits and five nonmerge diffs. All 25 redacted email/path/IP matches were classified as upstream metadata or synthetic fixtures; commit identities used noreply addresses. Binary/artwork and off-Git surfaces are outside that textual scan, and no pattern scanner proves absence of every secret.

Project license, third-party notice inventory, ten runtime JavaScript license files and Electron/Chromium notices were verified in the package. An altered project-license payload in a disposable ASAR was rejected by exact notice verification. Original tested artifacts were preserved.

## Local candidate identity

Both the application executable and installer report **NotSigned**. Hashes identify bytes and do not authenticate a publisher. Public downloads belong on [Releases](https://github.com/zeidlern/NerdSSHell/releases).

| File | SHA-256 |
| --- | --- |
| NerdSSHell-1.0.2-x64-Setup.exe | `4da8a31c122eb138a40844688c138a7d13aac13548c0b3b7405206ca4c123932` |
| app.asar | `886dc7ab9f7552758741a5b34d887cd17ce0d23406adf309f727aa352a72e864` |

## Distribution acceptance

The source is public and buildable under [LICENSE](../LICENSE). The unsigned candidate passed automated checks. Consumer Windows acceptance still requires clean-user install/upgrade, genuine UAC approve/cancel/alternate-account interaction, native file/color dialogs and GUI-driven transfers, and physical sound/toast/taskbar observations. Automated no-UAC fixtures do not establish those results.

Signed production distribution additionally requires enrolled publisher signing, timestamping and verification of the exact signed application/installer. See the [release process](PUBLIC-RELEASE.md). No published binary release or signing result is implied by source availability.
