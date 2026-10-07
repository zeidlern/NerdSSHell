# Release validation

Validation applies to NerdSSHell **1.0.2** on Windows x64. Exact source and artifact checks are required for each release; previous results do not validate changed bytes.

## Distribution

The source repository is public. Published downloads are available only from [Releases](https://github.com/zeidlern/NerdSSHell/releases). Candidate installers are unsigned; checksums verify bytes but do not authenticate a publisher. See the [release process](PUBLIC-RELEASE.md).

## Current checks

The final source, Windows tests, packaged acceptance, dependency and GitHub check results will be recorded here after the candidate completes validation. Pending checks are not passes.

The project uses JavaScript and does not configure a separate type checker or general-purpose linter. `npm run check` validates JavaScript syntax, version/branding consistency, UI resource references and publication configuration. GitHub workflows are checked with actionlint.

## Security review

The optional `sprintf-js` dependency advisory was removed from the locked graph through a scoped build-proxy update. Fresh supported and complete lockfile audits report no known vulnerabilities; dependency resolution and loopback proxy/checksum verification pass. See [dependency maintenance](DEPENDENCIES.md).

The 43 CodeQL alerts were individually reviewed: 42 concerned JSON literals sent directly to V8 through CDP in isolated acceptance scripts, without an HTML parser sink; one concerned a fixed expected-value expression in a test. Each was classified with a location-specific explanation. No queries or tests were disabled, and no escaping was added to alter shell commands.

Source review identified an aggregate terminal-allocation availability issue. Discovery and live/pending console limits now prevent a server's session list from causing unbounded automatic views. Regression and exact-package results are required before this fix is considered verified.

## Native acceptance

Automated disposable tests cover local consoles, SSH/SFTP, process ownership, packaged resources and the native bridge without UAC. They cannot establish genuine UAC approve/cancel/alternate-account interaction, clean-user installation/upgrade, native dialogs or physical Windows sound/toast/taskbar presentation. Those observations remain required for consumer Windows distribution. Publisher enrollment and signed-artifact verification remain required for a signed production release.
