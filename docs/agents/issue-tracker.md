# GitHub issue tracker

Use [NerdSSHell GitHub Issues](https://github.com/zeidlern/NerdSSHell/issues) for public tickets and specs. Read [SECURITY.md](../../SECURITY.md) for private vulnerability reporting and disclosure rules.

## Conventions

Use `gh` when available. Pass `--repo zeidlern/NerdSSHell` to `gh issue` commands so they target the official repository from any checkout. Where `gh` is unavailable, use the equivalent authorized GitHub connector or REST operation.

- **Fetch** an issue with `gh issue view <number> --json number,title,body,state,labels,comments`.
- **List** issues with `gh issue list --state open --json number,title,body,labels,comments`. Use `--label` and `--state` to scope the query.
- **Publish** a ticket or spec with `gh issue create --title "..." --body-file <file>`. Verify the returned issue URL.
- **Comment** with `gh issue comment <number> --body-file <file>`.
- **Apply or remove** labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`. Use the [triage label mapping](triage-labels.md).
- **Close** an issue by posting the reason as a comment and then running `gh issue close <number>`.

GitHub issues and pull requests share numbering. Resolve an ambiguous reference before acting on it.

## Sub-issues and dependencies

- Attach a child with `gh issue edit <parent> --add-sub-issue <child>` or create one with `gh issue create --parent <parent>`. For older `gh` versions, use the [sub-issues API](https://docs.github.com/en/rest/issues/sub-issues#add-sub-issue). Use `Part of #<parent>` in the child body where native sub-issues are unavailable.
- Record a blocker with `gh issue edit <child> --add-blocked-by <blocker>` or `gh issue create --blocked-by <blocker>`. For older `gh` versions, use the [issue dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies#add-a-dependency-an-issue-is-blocked-by). Use `Blocked by: #<blocker>` in the child body where native dependencies are unavailable.
- Both REST writes take the numeric database ID, obtainable with `gh api repos/zeidlern/NerdSSHell/issues/<number> --jq .id`.
- Before starting a ticket, list all its blockers and check their state. The ticket is unblocked when every blocker is closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

- Keep the map in a GitHub issue labeled `wayfinder:map`. Link child tickets as sub-issues and give each the matching `wayfinder:<type>` label (`research`, `prototype`, `grilling` or `task`).
- Select the first open, unassigned and unblocked child in map order. Claim it with `gh issue edit <number> --add-assignee @me` before starting work.
- Resolve a child by commenting with the answer and closing the issue. Add the decision and an issue link to the map's Decisions-so-far section.
