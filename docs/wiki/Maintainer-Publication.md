# Maintaining official releases

[Manual home](Home.md) · [Publish the Wiki](Publishing-the-Wiki.md)

The repository owner controls acceptance into official source, releases and repository administration. Public visitors can report bugs, request features and submit fork pull requests without receiving upstream write access. Source use and redistribution are governed by [LICENSE](https://github.com/zeidlern/NerdSSHell/blob/main/LICENSE).

## Repository controls

Keep Issues and fork pull requests available. Restrict Wiki editing to collaborators. Protect `main` through an active ruleset with pull requests, successful current checks, force-push blocking and deletion protection. Protect version tags against updates/deletion. Verify these settings in GitHub; workflow configuration alone does not enforce branch rules.

Use read-only default workflow tokens and full-SHA-pinned Actions. Require approval for external fork runs and keep untrusted code away from signing secrets and release workstations. Review collaborator/app grants and require the owner's authorization before granting official write or release access.

Maintain private vulnerability reporting, dependency alerts, code scanning and available secret scanning/push protection. Review each alert on its technical merits. Do not disable checks or mass-dismiss findings to make a dashboard green.

## Release validation and publication

Follow the repository's [release process](https://github.com/zeidlern/NerdSSHell/blob/main/docs/PUBLIC-RELEASE.md), [testing guide](https://github.com/zeidlern/NerdSSHell/blob/main/docs/TESTING.md) and [validation results](https://github.com/zeidlern/NerdSSHell/blob/main/docs/LAUNCH-VALIDATION.md).

Validate the exact reviewed source and Windows artifact, including dependencies, native resources, notices and applicable clean-user acceptance. Record actual failures, skips and manual limits. A no-UAC fixture cannot establish real consent behavior.

Create a new version tag from reviewed `main`; never reuse a published tag for changed bytes. Release notes should identify changes, platform requirements, checksums, signing status and limitations. A source release, an unsigned Windows download and a publisher-signed Windows release are distinct distribution states.

Publish consumer assets only, rather than full diagnostics archives. Signed distribution requires an approved publisher identity, protected signing environment and valid timestamped signatures on the application and installer. Keep signing enrollment and any paid service under the owner's control.

Synchronize the [Wiki](Publishing-the-Wiki.md), Help and README with the release. Delete only merged or deliberately superseded branches after verifying that their work is retained.

References: [personal repository permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository), [Wiki permissions](https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis) and [Actions security](https://docs.github.com/en/actions/reference/security/secure-use).
