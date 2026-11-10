# Tasks: Release infra with changesets

Parent: torrent-tv/meta#336, stage 2 (infra). Branch
`ci/ttv-336-release-with-changesets`. No `node:test` applies: no code under test
changes, only workflow YAML, `package.json`, shell steps and `scripts/check.sh`.
The checks are the Checks run of this pull request, scratch-repository runs
(design.md, Facts 5-7), throwaway pull requests and the first runs on `main`.
`[x]` is done and shown; `[ ]` waits for the merge, or for a blocker in design.md.

## 1. Files

- [x] 1.1 `package.json`, `package-lock.json`, `.npmrc`, `.node-version`, `.gitignore`,
      `.changeset/config.json`, `.changeset/README.md`.
- [x] 1.2 `scripts/check.sh` with `pins`, `images`, `compose`, `nginx`,
      `nginx-upgrade`, `revision`, `all`; `main.yml` calls one function per step.
- [x] 1.3 `main.yml`: `version`, `plan`, matrix `checks`, `publish`, `rebase-prs`,
      `deploy`, exact action versions.
- [x] 1.4 `dependencies.yml`: `update`, `push`, `result`, `disk`.
- [x] 1.5 README, AGENTS.md and this change describe the flow.
- [x] 1.6 `.changeset/ci-ttv-336-release-with-changesets.md`, in the last commit.

## 2. Acceptance criteria and checks

- [x] 2.1 No `peter-evans/create-pull-request`, `push-to-main`,
      `set-bot-identity`, `gh workflow run` or `uses: torrent-tv/workflows` in
      `.github/workflows`. Check: `git grep -nE 'create-pull-request|push-to-main|set-bot-identity|gh workflow run|torrent-tv/workflows' -- .github/workflows`
      prints nothing.
- [x] 2.2 Every action is at an exact version, and `npm-check-updates` 23.1.1,
      `semver` 7.8.6 and `@changesets/cli` 3.0.3 are exact devDependencies.
      Check: `bash scripts/check.sh pins` and `git grep -nE 'uses: [^ ]+@v[0-9]+$' -- .github`.
- [x] 2.3 The Checks run of the pull request passes, `Workflows are valid`
      included (actionlint 1.7.12 with the four documented ignores).
- [ ] 2.4 Changeset checks (design.md, Pull requests): two throwaway pull
      requests, each closed afterwards. A pull request without a changeset fails
      "Pull request adds a changeset". One that writes `^3.0.3` into
      `devDependencies` fails "Dependencies are pinned exactly". Check: run URLs.
- [ ] 2.5 After the merge, the release of this change: a `force_push` on
      `refs/heads/main` by `torrent-tv-release[bot]` follows the `pr_merge`
      (`gh api "repos/torrent-tv/infra/activity?ref=refs/heads/main"`); the
      changeset commit has its author, author time and header unchanged, sets
      `package.json` to `0.0.1`, adds `## 0.0.1` to `CHANGELOG.md` and deletes
      the changeset; the next run's `version` job logs `no pending changesets`;
      tag `v0.0.1` and its GitHub Release (body equal to the changelog section)
      exist; `deploy` is green. Waits for the release App secrets on `production`.
- [ ] 2.6 Window: the time from `pr_merge` to `force_push`, with the `version`
      job's step times, is recorded on torrent-tv/meta#336.
- [ ] 2.7 A throwaway pull request made on a pre-rewrite tip and holding a copy of
      a commit fails "Pull request carries no copy of a commit on main" until
      `rebase-prs` rebases it; it is then closed.
- [ ] 2.8 A pull request with two commits that each add a changeset yields two
      versions, two tags and two GitHub Releases, and its run had one Checks leg
      per changeset commit.
- [ ] 2.9 First `Dependencies` run after the merge ends in one of two ways: it logs
      `no updates` and `0 open Dependabot alerts` and pushes nothing, or it pushes
      its commits as the release App with the headers of design.md, each versioned
      and released. `update` has only `contents: read` and `vulnerability-alerts:
      read`, no environment and no `secrets.`; `push` has no `npm`, `npx` or test
      command.
- [ ] 2.10 A `workflow_dispatch` of `dependencies.yml` on a throwaway branch whose
      `scripts/check.sh` exits 1 ends red; its `push` job is skipped and the
      activity API shows no `push`. The branch is deleted afterwards.
- [ ] 2.11 Force-push of a range that holds a workflow change: the next merge that
      changes a workflow and adds a changeset is versioned by `version` with no
      refusal (the App has `workflows: write`, design.md Fact 8). Check: the
      `force_push` in the activity API.
- [x] 2.13 Node and npm are exact: `bash scripts/check.sh tools` passes in `checks`
      and fails when `.node-version` or `packageManager` differs from the runner's.
- [ ] 2.12 Every commit on `main` after this change either matches a merged pull
      request commit or is by `torrent-tv-release[bot]` with a header ending in
      `#ttv-386`, `#ttv-387` or `#ttv-388` and only the paths of design.md.
      Every `force_push` has actor `torrent-tv-release[bot]`. `git grep -n
      'HEAD:refs/heads/main' -- .github/workflows` finds two lines: the force-push of
      `version` and the push of `dependencies.yml`.
- [x] 2.14 The copy check compares each commit of a pull request with the whole history of `main`,
      and a changeset must be one plain sentence. Check: `bash scripts/check.sh changesets-selftest`
      exits 0 (the earlier range comparison passes the copy, `copies` fails it; each format rule fails
      its bad input), and the step "Changeset checks fail on bad input" passes in `Checks`.
