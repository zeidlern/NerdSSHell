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

The project uses the custom [NerdSSHell Source-Available License](LICENSE), rather than a permissive open-source license. GitHub viewing and forking rights are governed by GitHub's terms. Submitting a proposal does not grant general rights to redistribute source or binaries, publish modified builds, or use project branding for a third-party distribution. Obtain the copyright holder's written permission when LICENSE requires it.

Submit only work you have the right to share and identify any third-party code or license requirements in the pull request. Third-party components retain their own licenses. No CLA or assignment is implied by this contribution guide.