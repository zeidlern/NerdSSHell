# Publishing the Wiki

[Manual home](Home.md) · [Maintainer releases](Maintainer-Publication.md)

The editable manual lives in `docs/wiki/` in the source repository. GitHub publishes the Wiki from a separate Git repository at `https://github.com/zeidlern/NerdSSHell.wiki.git`. Source commits do not publish Wiki pages automatically.

## Export

From the source checkout containing the reviewed manual, export into a new directory:

```powershell
$wikiExport = Join-Path $env:TEMP ('NerdSSHell-wiki-' + [guid]::NewGuid().ToString('N'))
node .\scripts\Prepare-Wiki.cjs $wikiExport
if ($LASTEXITCODE -ne 0) { throw 'Wiki export failed.' }
```

The exporter validates local page targets, converts `.md` page links into Wiki links and writes the pages, sidebar and footer. It refuses to overwrite an existing destination and does not authenticate or push.

## Publish

Clone `https://github.com/zeidlern/NerdSSHell.wiki.git` into a new directory using normal Git/Git Credential Manager authentication. Keep credentials out of clone URLs and prompts.

Inspect the Wiki's current upstream/default branch and existing pages. The branch may be `master`; do not assume `main`. Reconcile substantive existing edits before copying the exported Markdown. Use the intended verified Git identity in this checkout's local configuration.

Review the complete diff and run `git diff --check`. Commit the intended pages and perform an ordinary push to the discovered default branch. If the remote changed, fetch and reconcile normally. Do not force-push or rewrite Wiki history.

Verify the live Home, sidebar and chapter links after publishing. Keep **Settings > General > Features > Restrict editing to collaborators only** enabled; source branch protection does not govern Wiki edits.

## Maintain

Make manual changes in `docs/wiki/` through reviewed source pull requests, then export and publish after merge. Reconcile direct Wiki edits before replacing pages. Keep secrets, real connection screenshots and private paths out of both copies.

See GitHub's [Wiki editing guide](https://docs.github.com/en/communities/documenting-your-project-with-wikis/adding-or-editing-wiki-pages) and [Wiki permissions](https://docs.github.com/en/communities/documenting-your-project-with-wikis/changing-access-permissions-for-wikis).
