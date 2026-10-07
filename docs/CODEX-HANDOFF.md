# Maintainer handoff

The application is implemented. Preserve it, its application ID and existing settings. Read AGENTS.md, SECURITY.md, SECURITY-REVIEW.md and PUBLIC-RELEASE.md. Do not restart from a scaffold.

Work on a branch from the current repository. Run `npm ci --omit=optional`, `npm run check`, `npm test`, and the disposable Linux integration tests where supported. Build and launch the Windows installer as a non-administrator. Record commit IDs and observed results, not assumptions.

Remaining work is the public-release checklist: signing/fuses/ASAR packaging, full-history privacy review, a chosen license, private reporting, fresh dependency/secret/code scans, clean-Windows acceptance and hostile-server regression coverage. Do not publish, rewrite history, buy signing services or disable OS protections without explicit owner approval.

Use a disposable SSH server/account and unique sessions for typing, resizing, interruption, upload and termination tests. Real user sessions are never destructive test fixtures. Authentication, first-use trust, changed-key cancellation, two-host view isolation, reconnect races, four panes, DPI scaling, archive rotation/ACLs, file dropping and persistence need real desktop coverage.

Treat configured CI as a plan until its exact run succeeds. Preserve any failure output without credentials. Update ACCEPTANCE-RESULTS.md with a generic test matrix, not personal hosts or paths. Report the installed executable, commit, actual tests and unresolved risks.
