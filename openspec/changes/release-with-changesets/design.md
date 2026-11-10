# Design: Release infra with changesets

Facts below were read from the files named, the GitHub documentation, or measured
in scratch repositories and on GitHub runners; each says which. Analysis is marked.

## Facts

1. `@changesets/cli` 3.0.3 (run in this repository): `changeset version` consumes
   every changeset file and writes `## <version>` into `CHANGELOG.md` with the
   line `- <summary>` when HEAD is the commit's parent; `changeset git-tag` tags
   `v<version>` for a private package when `privatePackages.tag` is true.
2. `git rebase --exec` refuses a command with a newline ("exec commands cannot
   contain newlines"), so the amend step is a file written to `$RUNNER_TEMP`.
3. Reading Dependabot alerts with `GITHUB_TOKEN` needs `permissions:
   vulnerability-alerts: read`. Measured on this repository, run 42828339350: the
   alerts endpoint answered 200 with `vulnerability-alerts: read`, and 403
   "Resource not accessible by integration" with `security-events: read` and with
   the default permissions. The documentation says the same: "For Dependabot
   alerts, use the `vulnerability-alerts` permission" and "Only `read` and `none`
   are supported" (docs.github.com, workflow syntax, `permissions`). The
   owner's earlier note named `security-events`; the measurement shows it does not
   work.
4. actionlint 1.7.12 does not know the scope `vulnerability-alerts`; the Checks
   step ignores that one message, as it does three others.
5. The scripts of `version`, `publish`, `rebase-prs` and `dependencies.yml` ran
   against scratch git repositories with a bare origin (no network except the npm
   registry, no torrent): three changeset commits give versions 0.0.1 and 0.1.0
   with a plain commit between, a second run leaves the tip unchanged, a lease
   refusal ends in `state=moved`, a commit that edits a line next to `version`
   conflicts and is resolved, a tagged commit in the range is refused, a pull
   request branch holding a pre-rewrite copy is rebased without the copy, and a
   conflicting one gets a comment.
6. npm resolves an override whose key names a range, `<package>@<vulnerable
   range>`: in a scratch project a direct `minimist 1.2.5` stayed and a nested
   `minimist 0.0.8` became `0.2.4`. A plain `<package>` override replaced both.
7. `npm-check-updates` 23.1.1 with `--target minor` keeps the exact form of a
   pinned version (`1.2.5` became `1.2.8`, not `^1.2.8`).
8. The release App has `actions: write` now and no `workflows` permission.
   GitHub refuses a push that creates or updates a file under `.github/workflows/`
   from an App without that permission.

## Decisions (analysis)

### States

A commit is pending while its tree holds a changeset file other than
`README.md` and `config.json`. It is versioned when it added a changeset and
the same commit deleted it. A version is released when its tag and GitHub
Release exist. Each job decides from that state.

### The version job

`version` is the first job of a push to `main`. It ends with one of three
states, which later jobs read:

- `moved`: `origin/main` is no longer the run's commit; a newer run versions it.
- `rewritten`: it force-pushed (`--force-with-lease=refs/heads/main:$GITHUB_SHA`);
  the push starts the next run.
- `current`: no changeset is pending; `checks`, `publish`, `rebase-prs` and
  `deploy` go on.

The range starts at the parent of the oldest commit that added a still-pending
changeset. It is refused when it holds a merge, a commit with a `v*` tag, or the
first commit. `git rebase --exec` replays the range and amends each commit that
added a changeset: `git reset --soft HEAD~1`, `changeset version`,
`npm install --package-lock-only --ignore-scripts`, a check that only
`package.json`, `package-lock.json`, `CHANGELOG.md` and `.changeset/*.md` changed,
then `git commit -C ORIG_HEAD`. Author, author time and message are kept; the
committer is the release App. A conflict in `package.json` or `package-lock.json`
(a later commit edited a line next to `version`) is resolved by taking the
commit's own text and setting the version back to the parent's; any other
conflict aborts the rebase and fails the job naming the commit and the files.

The run that finds nothing pending ends the loop: no workflow path filter and
no skip marker is used, so the rewritten commits get their own checks.

### Publication

`publish` runs after `checks`, one at a time (`concurrency: publish`, queued). The
versions are the commits since the newest reachable `v*` tag's own commit that
added a `## <version>` heading to `CHANGELOG.md`. For each, oldest first, it
tags with `changeset git-tag`, pushes the tag with `GITHUB_TOKEN` (a tag push
starts no run), and creates the GitHub Release from the changelog section. A tag that
exists on another commit fails the job. A re-run finishes what is missing.

### Pull requests

- `plan` lists the commits of the pull request that add a changeset; `checks` runs
  on each of them and on the head (merged with `main`), so every commit that will
  become a version passes (AGENTS.md Process 3).
- A pull request adds a changeset (`changeset status --since=origin/main`), carries
  no commit that `main` holds under another hash (same author e-mail, author time
  and subject), and does not edit or rename a changeset an earlier commit added.
- `rebase-prs` rebases each open same-repository pull request onto the new `main`
  with `git rebase --onto origin/main <fork>`, where `<fork>` is the newest commit
  of the pull request whose author e-mail, author time and subject also appear on
  `main`, or else the merge base. A conflict is commented on the pull request and
  left to its author. The rebase changes the head, so the reviewer's approval no
  longer meets the merge condition; the reviewer reads `git range-diff`.

### Deploy

`deploy` needs `checks`, which runs only when the `version` job ended `current`.
`production` is forward-only; a pending tip is never deployed, and later rewrites
start at a commit after every deployed tip.

### Dependencies

`dependencies.yml` has two jobs plus a result and the disk check:

- `update` (`contents: read`, `vulnerability-alerts: read`, no secret, no
  environment) runs package code. It makes commits as the release App identity in
  this order: Dependabot alerts (C1), minor updates (C2), image digests (C3). Each
  commit is tested on its own tree, oldest first, with `scripts/check.sh all`; the
  first failure stops the testing and only the commits before it are kept. The
  commits leave as `git format-patch` files in an artifact (one day).
- `push` (environment `production`, release App token) runs no package code. It
  checks that the patches write only `package.json`, `package-lock.json`,
  `docker-compose.yml` and `.changeset/*.md`, applies them with `git am` and
  pushes. After a refusal it fetches and runs `git rebase --onto origin/main
  <old base>`, up to three attempts. The old base is named because the checkout is
  detached and `main` may have been rewritten meanwhile.
- `result` fails the run while an alert cannot be fixed (not npm, no lock file, no
  patched version, or a copy that still matches its range) or a check failed. The
  commits that passed are already on `main`.

An alert is raised by `npm install <name>@<patched> --save-exact` when a direct
dependency is inside the vulnerable range, otherwise by `npm update <name>`, and
if a copy still matches the range an override `<name>@<vulnerable range>` holds it
at the patched version. A patched version in a higher major is applied too; the
checks decide.

The workflow never dismisses an alert. A dismissal needs a reason and the
`torrent-tv-coordinator` App (owner decision, 2026-11-10).

### Changesets and commit headers

| Commit | Changeset | Header |
|---|---|---|
| alerts | `deps-alerts-<run>-<attempt>.md`, patch, one line per alert | `fix(deps): fix <n> Dependabot alert(s) #ttv-386` |
| updates | `deps-<run>-<attempt>.md`, patch | `fix(deps)` when a lock entry that is not a development dependency changed, else `chore(deps): update dependencies #ttv-386` |
| digests | `deps-digests-<run>-<attempt>.md`, patch | `fix(deps): update the digest of <images> #ttv-386` (`<n> images` when the header would pass 100 characters) |
| server install | written by server's `install` job | `chore(deploy): run server <v> #ttv-388` |

Every package in infra's `package.json` is a development tool, so the updates
commit is `chore(deps)`.

## Blockers and unknowns

1. The release App secrets are not on infra's `production` environment
   (`gh api repos/torrent-tv/infra/environments/production/secrets`, 2026-11-10).
   The first run after the merge fails at the token step until the owner adds
   `RELEASE_APP_PRIVATE_KEY` and the coordinator sets `RELEASE_APP_CLIENT_ID`.
2. The release App has no "Workflows" permission. Each force-push or rebase that
   creates a new commit changing `.github/workflows/*` is refused: the first
   rewrite of a range that holds such a commit, and `rebase-prs` for a pull
   request that changes a workflow. This pull request carries its changeset in
   the last commit, which changes no workflow, so its own rewrite does not need
   the permission. The acceptance criterion for the force-push of workflow
   changes waits for the owner to grant it. Nothing here works around it.
3. Dependabot alerts are enabled on this repository (`gh api
   repos/torrent-tv/infra/vulnerability-alerts` answered 204). With a lock file
   the alerts of the three tools appear after the first push; none is known.
4. Unknown until it runs on GitHub: how long the `version` window is
   (merge to force-push), and whether the bot's pushes count as repository
   activity for GitHub's 60-day rule on scheduled workflows.
5. yq is not used in this repository. The server `install` job edits this
   repository's `docker-compose.yml` with yq 4.54.1; whether its one-line guard
   passes on the real file was not measured here, because yq is not installed on
   this Mac and docker is not available for it.

## Five answers

1. The viewer: nothing changes on the page; a security fix reaches the droplet
   the day after Dependabot reports it, with no review wait; every deployed commit
   has a version and a tag.
2. Cost to build: one pull request, about 1000 lines of workflow, no script
   beyond `scripts/check.sh`.
3. Cost to maintain: the `version`, `rebase-prs` and `dependencies.yml` steps are
   copies of those in proxy, server and ha-addon and change together (AGENTS.md
   Process 6); each merge costs a re-review of every rebased pull request.
4. Alternatives: a separate release commit and a "Version Packages" pull request
   were withdrawn by the owner; Renovate (AGPL-3.0, pull requests) and Dependabot
   version updates (pull requests, no `#ttv-386` suffix) were compared in the plan.
5. Undo: revert this pull request; rewritten history is not restored, but tags and
   versions stay valid.
