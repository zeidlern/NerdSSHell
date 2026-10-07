# Publish safely and protect the official repository

[Manual home](Home.md) · [Publish the Wiki](Publishing-the-Wiki.md)

This is a staged checklist for a personal-account repository. Complete it in order; do not click **Public** merely to remove a GitHub warning. Read the dated publication audit in `docs/PUBLICATION-AUDIT-2026-10-06.md` first. Repository settings must be verified in GitHub; committing this page does not configure them.

## What public does and does not mean

Public means visitors can read and copy/fork the visible repository. A fork is their copy, not permission to edit your official `main`. They cannot push into your repository unless an account or app has been granted write access. Source-license terms govern permitted reuse; GitHub permissions govern who can change your repository. Neither branch protection nor a license makes a vulnerable executable safe.

**Recommended ownership model:** you are the only person with write access unless someone genuinely helps maintain code. Testers download a release or submit an issue; they do not need collaborator access. Apps acting with your credentials can exercise your permissions, so a PR workflow is not a guarantee of independent human review when an agent can also merge as you.

Official reference: https://docs.github.com/en/account-and-profile/reference/permission-levels-for-a-personal-account-repository

## Stage 1: resolve privacy and release blockers while private

Review all reachable branches/tags, commit authors/committers/messages, old file versions, PR descriptions/comments/attachments, workflow logs and download artifacts. Deleting a file on `main`, deleting merged branches, or hiding a current screenshot does not erase its earlier versions. GitHub explicitly warns that Actions history/logs become public when repository visibility changes.

The current audit found personal email in commit metadata. Decide whether to retain reviewed history knowingly or authorize a carefully backed-up history cleanup. Do not force-push, recreate history or delete evidence automatically. A history rewrite changes SHAs and can require collaborator recloning and new validation; remote PR references/caches/attachments need separate consideration. Revoke any real exposed credential before removing it.

For future commits, open your **account Settings > Emails**, enable **Keep my email addresses private** and **Block command line pushes that expose my email**, and copy the exact GitHub-provided noreply address into local Git configuration. Do not assume these settings retroactively change old commits. Secure the account with a passkey or strong two-factor authentication and retain recovery codes privately.

Review the custom LICENSE and original artwork rights before distribution. Source visibility is not a permissive open-source license; third-party dependencies and logos retain their own rights. Do not imply endorsement by Microsoft, Linux projects or their trademark owners. Legal review is separate from the technical audit.

References: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository and https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address

## Stage 2: restrict access and contribution surfaces

In **Repository Settings > Collaborators / Collaborators & teams**, inspect who has access. Remove write access that was given solely for downloading a test build. Do not remove an active maintainer or necessary integration without identifying its purpose. Review installed GitHub Apps and personal tokens separately; limit them to necessary repositories and permissions.

Under **Settings > General > Features**:

- Keep **Issues** enabled for ordinary bug reports and requests.
- Keep **Pull requests** enabled, but choose **Collaborators only** when unsolicited code proposals are unwanted. Test the intended maintainer/Dependabot workflow after changing this option; do not grant broad write access to solve a contribution-policy mismatch.
- Keep **Wikis** enabled and **Restrict editing to collaborators only** checked. The main repository's branch rules do not automatically protect the separate Wiki Git repository.
- Enable **Automatically delete head branches** under pull-request settings for future merged work. Keep auto-merge off initially so merges remain a deliberate step.

If the Wiki is unavailable while private on the current plan, keep using `docs/wiki/`; do not expose unreviewed history just to enable a documentation feature.

References: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-pull-requests and https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis

## Stage 3: protect main without locking out a sole maintainer

Open **Settings > Rules > Rulesets > New ruleset > New branch ruleset**. Name it `Protect main`, set enforcement to **Active**, and target **main** (or the default branch). Start with no routine bypass actors. Public repositories support rulesets on Free; private-repository availability depends on plan. Do not change visibility before privacy review merely to gain protection.

| Setting | Initial choice | Reason |
| --- | --- | --- |
| Restrict deletions | On | Prevent deleting the official branch |
| Block force pushes | On | Prevent replacing shared branch history casually |
| Require a pull request before merging | On | Keep changes isolated and reviewable |
| Required approvals | **0 while you are the only reviewer** | You cannot approve your own PR; requiring another reviewer without having one creates a lockout |
| Require status checks | On | Require `tests`, `windows`, `dependencies`, `secrets` from GitHub Actions |
| Require branches to be up to date | On | Evaluate changes against current main before merging |
| Bypass list | Empty initially | Do not give an AI app or collaborator an unrestricted route around checks |

Do not turn on **Restrict updates** in this first ruleset without designing a specific update/bypass policy: that can block all ordinary merges. Do not require code-owner/last-pusher review until there is a workable independent reviewer. Do not select nonexistent or skipped check names. After CodeQL actually runs successfully, add its actual JavaScript and Actions matrix check names to the required set.

Save, reopen the rule and verify that it is **Active**, targets `main`, and has the intended checks. A rule file or a green workflow alone is not enforced branch protection. Review changes on a feature branch, open a PR, inspect the diff/checks, merge deliberately, and remove only the finished branch. Do not test protection with a destructive force push against real main.

This prevents strangers editing the official code and reduces mistakes by authorized writers. With zero reviews it does not enforce a second human approval; that requires a second trusted reviewer or carefully separated automation permissions. Administrators capable of editing rules remain a trust boundary.

References: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository and https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets

## Stage 4: validate security and the exact installer

Use the final reviewed commit, not an old green run. Require source tests, real disposable SSH integration, Windows regressions, package verification, native packaged tests, dependency checks and secret scanning. Keep skipped/manual checks explicit.

The optional dependency report is nonblocking; it is not clean merely because `dependencies` is green. The supported build omits optional packages, and the publication check verifies their absence after installation. Review residual advisories and the exact generated SBOM. Do not use `npm audit fix --force`, disable a scanner or change its severity threshold just to obtain a badge.

In **Settings > Actions > General**, retain read-only default workflow-token permissions, approved full-SHA-pinned actions and approval for all external contributors' fork runs. Do not enable PR approval by workflow tokens unnecessarily. Never expose signing credentials to fork code or run untrusted jobs on your workstation/self-hosted release runner.

Sign the final executable and installer with the intended verified publisher identity and a timestamp. Protect the signing environment and its secrets with deliberate approval and main-only restrictions. Run `Verify-Signed.ps1` and exact-package integrity/notices checks against those actual artifacts. A checksum beside an unsigned file is not publisher authentication.

Run clean-user Windows acceptance: ordinary non-admin install/upgrade/uninstall, saved-data preservation, first-use/changed-key/cancel authentication, all supported shells and layouts, genuine UAC approval/cancellation and alternate-user behavior, native file pickers/transfers, alerts, and explicit recording retention/deletion behavior. Use disposable hosts/accounts and synthetic files, not real production sessions. Log failures, not just passes. Wait for a signed and adequately tested release before recommending installation to general users.

## Stage 5: change visibility only after approval

When the history/privacy decision is resolved and source publication is approved, use **Settings > General > Danger Zone > Change repository visibility > Public**, review the repository name and consequences, and confirm.

Immediately inspect **Settings > Security / Security and quality > Advanced Security**. Enable/verify available secret scanning, push protection, Dependabot alerts and private vulnerability reporting. Verify the **Report a vulnerability** route from a separate account without submitting secrets. The policy text alone does not enable it.

The corrected CodeQL workflow is intended to run on the public event and later pushes/PRs. Verify both matrix analyses actually run and upload results. If the publication event did not trigger, use the workflow's manual run on main. A skipped job is still not a pass. Private availability has separate plan/feature requirements; do not enable an unsupported paid feature implicitly.

View the public repository while signed out. Confirm that downloads/docs are reachable, no sensitive history/logs/artifacts are exposed, and the Wiki cannot be edited by a visitor. Read access is expected; upstream write access is not.

Reference: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility

## Stage 6: publish the actual version and keep it maintainable

Create the version tag from the exact reviewed main commit only when ready. A package version of 1.0.0 does not create `v1.0.0` or a Release automatically. Do not move/reuse a published tag for changed bytes. Protect version tags against updates/deletion with a separate tag ruleset; permit controlled creation by the intended maintainer/release identity.

Create a draft GitHub Release with the exact Windows x64 installer, checksum manifest, release notes/known limitations, final generated dependency inventories and license notices. Verify the publisher/signature and asset names before publishing. Do not upload a whole CI evidence ZIP containing diagnostics, screenshots, user paths or private configuration as a consumer download.

Publish the Wiki copy using [Publishing the Wiki](Publishing-the-Wiki.md), link its Home page and the release from README, then test the actual consumer download in a fresh Windows user profile.

For existing extra branches, first compare against main and inspect open PRs. Delete only fully merged or deliberately superseded branches after preserving their work. A duplicate dependency change may be represented by different commit SHAs; inspect its diff, not just an `ahead` count. Do not disable dependency monitoring merely to keep the branch list at one forever.

Future work should use short-lived branches and tested PRs. One long-lived `main` is compatible with temporary development branches. Regularly review dependency alerts, security reports and access grants. Neither publication nor the label 1.0 ends maintenance responsibility.
