# Publish the prepared Wiki pages

[Manual home](Home.md) · [Publication checklist](Maintainer-Publication.md)

The complete editable manual lives in `docs/wiki/` in the source repository. GitHub's **Wiki tab is a separate Git repository**. Committing `docs/wiki/` does not automatically fill that tab. The connector used to prepare this manual can write the source repository but cannot authenticate and push the native Wiki.

## One-time GitHub preparation

Keep the repository private until the publication checklist is resolved. In **Settings > General > Features**, enable Wikis and leave **Restrict editing to collaborators only** checked. Open the Wiki tab and create its initial **Home** page if it has never been initialized. A temporary page saying that the reviewed manual will be uploaded is sufficient.

Private Wiki availability depends on your GitHub plan. The source manual remains readable in `docs/wiki/` to authorized users even before the separate Wiki is available. Do not make the repository public solely to work around a plan restriction.

## Prepare an offline copy

In a clean source checkout containing the merged manual, run the exporter with a **new** destination outside tracked source:

```powershell
$export = Join-Path $env:TEMP ('NerdSSHell-wiki-' + [guid]::NewGuid().ToString('N'))
node .\scripts\Prepare-Wiki.cjs $export
if ($LASTEXITCODE -ne 0) { throw 'Wiki export failed.' }
```

The exporter validates local page targets, converts `.md` page links into Wiki links and writes the pages, sidebar and footer. It refuses to overwrite an existing export directory. It does not authenticate, push, change repository permissions or delete pages.

## Review and publish with local Git

Clone `https://github.com/zeidlern/NerdSSHell.wiki.git` into a **new** directory using normal Git/Git Credential Manager authentication. Do not put a token into the URL or an AI prompt. An uninitialized or unauthorized Wiki can fail to clone; establish the actual reason rather than creating a different repository.

Inspect the Wiki's current default branch and files. It may use `master`; do not assume it is the main source repository's `main`. Only the Wiki's default branch is published. Preserve substantive existing pages and user edits. Reconcile name collisions before copying the exported Markdown pages; the initial placeholder Home page can be replaced deliberately.

Before committing, use your exact GitHub-provided noreply address from account email settings in this Wiki checkout's **local** Git configuration. This keeps new Wiki commits from exposing a personal email; it does not sanitize old commits. Avoid changing global identity for unrelated repositories.

Review the complete diff and run `git diff --check`. Stage only the intended Markdown pages, commit with a descriptive message and use an ordinary `git push` to the discovered upstream/default branch. Do not force-push, delete the Wiki history or overwrite unknown pages. A concurrent update requires fetching and reconciling normally, not forcing your copy over it.

Open the Wiki on GitHub and verify Home, the sidebar, installation/Codex pages and links from several chapters. Previewing a local Markdown file does not prove GitHub published it.

## Copy-ready local Codex publishing prompt

```text
Publish the reviewed NerdSSHell user manual to the existing GitHub Wiki for zeidlern/NerdSSHell. This task is documentation publication only; do not change repository visibility, branch rules, license, releases, application source or installed user data.

Read docs/wiki/Publishing-the-Wiki.md and the current publication audit. Verify that the source checkout contains the reviewed manual commit and has no uncommitted user changes. Do not reset, clean, overwrite or silently stash user files. Run node scripts/Prepare-Wiki.cjs with a new export directory outside tracked source.

Using normal local Git authentication, clone https://github.com/zeidlern/NerdSSHell.wiki.git into a new review directory. Never put a token in a URL or prompt. If the Wiki does not exist yet, tell me to create its initial Home page in the GitHub Wiki UI; do not create another source repository or change visibility to solve this.

Inspect the Wiki's actual default branch and upstream; do not assume main. Read existing pages and preserve substantive content and edits. Reconcile collisions before copying prepared pages, including _Sidebar.md and _Footer.md. Use my GitHub noreply email for new Wiki commits; obtain the exact address from my existing verified local configuration or ask me to copy it from GitHub account email settings if unavailable. Do not guess it or change global Git identity.

Show the meaningful diff, check page links and git diff --check, then commit and perform an ordinary push to the Wiki default branch. No force push, mass deletion or history rewriting. If the remote moved, reconcile safely rather than overwriting it. Verify the live Wiki Home, sidebar and installation/Codex links afterward. Report the Wiki commit and actual publication result; do not claim the Wiki is live merely because the source manual is committed.
```

## Keep source and Wiki synchronized

Make future manual changes in `docs/wiki/` through the source repository's reviewed PR process. Export and republish after merge. Avoid editing both copies independently without reconciliation. Store no secrets, real connection screenshots or private paths in either copy.

Official instructions: https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages

Wiki permissions: https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis
