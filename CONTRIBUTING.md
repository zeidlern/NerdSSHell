# Contributing to NerdSSHell

Bug reports, feature requests, documentation improvements and focused pull requests are welcome. The repository owner decides what is accepted into official source and releases. Forking or submitting a pull request does not grant write access to this repository.

## Bugs and features

Search [existing issues](https://github.com/zeidlern/NerdSSHell/issues) first. Use the bug template for defects or the feature template for suggestions. Include the NerdSSHell version, Windows version, connection/session type, reproduction steps and expected versus actual behavior. Use synthetic hosts and output; redact credentials, usernames, private paths and terminal content from attachments.

Report vulnerabilities through [SECURITY.md](SECURITY.md), rather than a public issue or pull request.

## Pull requests

For a substantial change, open an issue first so its scope can be discussed. For a small fix, fork the repository, create a focused branch and submit a pull request against `main`. Explain the problem, the resulting behavior and the checks you actually ran. Keep unrelated changes separate and preserve existing profiles and upgrade compatibility.

Use Windows 11 x64 and Node 22 x64 at least 22.12.0. From the repository root:

```powershell
npm.cmd ci --omit=optional
npm.cmd run check
npm.cmd test
```

`npm run check` performs source syntax and project consistency checks. Authentication, IPC, terminal protocol, storage, elevation and packaging changes need adversarial regressions and appropriate Windows validation. Use [disposable fixtures](docs/TESTING.md); do not test destructive commands on real user sessions or change global server/security settings. Read [AGENTS.md](AGENTS.md), [architecture](docs/ARCHITECTURE.md) and the [security boundaries](docs/SECURITY-REVIEW.md) before changing those paths.

Do not commit credentials, private keys, connection profiles, user data, terminal archives or signing material. Contributor workflows must not receive release credentials or unnecessary write permissions.

## License and ownership

NerdSSHell's project-owned source in this revision is licensed under the [GNU General Public License version 3.0 only](LICENSE) (`GPL-3.0-only`). Individuals and businesses may use, modify, and redistribute the software under GPLv3 terms, including corresponding-source obligations for distribution. Earlier published releases retain their historical license terms.

Contribute only material you have the right to license under GPLv3 and disclose any third-party licenses or attribution requirements. Contributions accepted into this GPLv3 project must be available under GPL-3.0-only; **no copyright assignment or contributor license agreement is implied** by sending a pull request. Commercial relicensing of contributed code requires the applicable rights holder's separate permission. No rights to the NerdSSHell name or logos are granted beyond applicable law.
