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
- [x] 2.4 Changeset checks (design.md, Pull requests): two throwaway pull
      requests, each closed afterwards. A pull request without a changeset fails
      "Pull request adds a changeset". One that writes `^3.0.3` into
      `devDependencies` fails "Dependencies are pinned exactly". Check: run URLs.
      Shown: on 2026-11-10 infra#22 (branch `chore/ttv-336-throwaway-nochangeset`, valid name,
      no changeset) failed `Checks` at "Pull request adds a changeset" (run 42924958868; before
      that, infra#11 failed there too, run 42830077001); infra#23
      (`chore/ttv-336-throwaway-range`, `semver` written as `^7.8.6` in `devDependencies`)
      failed at "Dependencies are pinned exactly" with `not an exact version:
      devDependencies.semver = ^7.8.6` (run 42924964318); infra#21 (a branch naming no task)
      failed at "Branch name names a task" (run 42924953813). All three were closed unmerged and
      their runs deleted (meta#336 comment 6782567095, AC 7 and 17).
- [x] 2.5 After the merge, the release of this change: a `force_push` on
      `refs/heads/main` by `torrent-tv-release[bot]` follows the `pr_merge`
      (`gh api "repos/torrent-tv/infra/activity?ref=refs/heads/main"`); the
      changeset commit has its author, author time and header unchanged, sets
      `package.json` to `0.0.1`, adds `## 0.0.1` to `CHANGELOG.md` and deletes
      the changeset; the next run's `version` job logs `no pending changesets`;
      tag `v0.0.1` and its GitHub Release (body equal to the changelog section)
      exist; `deploy` is green. Waits for the release App secrets on `production`.
      Shown: infra#11 `pr_merge` 2026-11-10 14:59:33 UTC, `force_push` by
      `torrent-tv-release[bot]` at 14:59:50; a7d9a45 keeps its author and header, sets
      `package.json` to 0.0.1 and adds `## 0.0.1` to `CHANGELOG.md`; run 42839776017: `Version`
      logs `no pending changesets`, `Checks`, `Publish` and `Deploy` success; tag `v0.0.1` is on
      a7d9a45 and its GitHub Release body is the `CHANGELOG.md` section (meta#336 comment
      6781047118, AC 2 and 15; tag and Release read again 2026-11-11).
- [x] 2.6 Window: the time from `pr_merge` to `force_push`, with the `version`
      job's step times, is recorded on torrent-tv/meta#336.
      Shown: `pr_merge` 14:59:33, `force_push` 14:59:50 (17 s); `version` job from 14:59:41: app
      token 1 s, checkout 1 s, setup-node 1 s, `npm ci` 1 s, "Version every commit that holds a
      changeset" 3 s (14:59:47-14:59:50); recorded on torrent-tv/meta#336 as "Version window (AC
      15)" (comment 6781047118).
- [x] 2.7 A throwaway pull request made on a pre-rewrite tip and holding a copy of
      a commit fails "Pull request carries no copy of a commit on main" until
      `rebase-prs` rebases it; it is then closed.
      Shown: infra#20 (`chore/ttv-336-throwaway-copy`), cut on the pre-rewrite tip 66e555b with
      one changeset commit: run 42924949011 failed "Pull request carries no copy of a commit on
      main" naming `chore(deploy): run server 0.66.59 #ttv-388`; after the server install
      rewrote `main`, `rebase-prs` (run 42925924818) logged `rebased #20 2a74679 -> d2cb3f5` and
      the new run 42925992318 passed that step. The pull request was closed unmerged and its
      runs deleted (meta#336 comment 6782567095, AC 13).
- [ ] 2.8 A pull request with two commits that each add a changeset yields two
      versions, two tags and two GitHub Releases, and its run had one Checks leg
      per changeset commit.
      Not shown in this repository: no merged infra pull request had two commits that each added
      a changeset; the probe pull request infra#12 (closed unmerged) showed three `Checks` legs
      (run 42831372106) but released nothing. Two such commits were released as two versions,
      two tags and two Releases in proxy#66 (v2.107.83 and v2.107.84; meta#336 comment
      6781047118, AC 14). Archived unticked.
- [x] 2.9 First `Dependencies` run after the merge ends in one of two ways: it logs
      `no updates` and `0 open Dependabot alerts` and pushes nothing, or it pushes
      its commits as the release App with the headers of design.md, each versioned
      and released. `update` has only `contents: read` and `vulnerability-alerts:
      read`, no environment and no `secrets.`; `push` has no `npm`, `npx` or test
      command.
      Shown: `Dependencies` run 42925419499 (`workflow_dispatch`, 2026-11-10 23:41 UTC):
      `Update`, `Disk space` and `Result` success, `Push to main` skipped; it logged `0 open
      Dependabot alerts`, `no updates`, `0 commits passed` and pushed nothing. `update` has only
      `contents: read` and `vulnerability-alerts: read`, no environment and no `secrets.`;
      `push` runs no `npm`, `npx` or test command (meta#336 comments 6781047118, AC 9(b), and
      6782567095, AC 9(a)).
- [x] 2.10 A `workflow_dispatch` of `dependencies.yml` on a throwaway branch whose
      `scripts/check.sh` exits 1 ends red; its `push` job is skipped and the
      activity API shows no `push`. The branch is deleted afterwards.
      Shown: run 42925258556, a `workflow_dispatch` on the throwaway branch
      `fix/ttv-336-throwaway-failing-dispatch` whose `scripts/check.sh all` ended in `&& false`:
      `Update` success, `Result` failure, `Push to main` skipped; the log says `the checks
      failed on "chore(deps): update dependencies #ttv-386"; it and the commits after it are not
      pushed` and `0 commits passed`; the activity API showed no push from it. The branch and
      the run were deleted afterwards (meta#336 comment 6782567095, AC 9(c)).
- [x] 2.11 Force-push of a range that holds a workflow change: the next merge that
      changes a workflow and adds a changeset is versioned by `version` with no
      refusal (the App has `workflows: write`, design.md Fact 8). Check: the
      `force_push` in the activity API.
      Shown: infra#14 `pr_merge` 2026-11-10 20:42:01 UTC changed
      `.github/workflows/dependencies.yml`; the release App's `force_push` at 20:42:15 (71ef749
      -> f33d0ed, tag `v0.0.5`) was accepted with no refusal (meta#336 comment 6781047118).
- [x] 2.13 Node and npm are exact: `bash scripts/check.sh tools` passes in `checks`
      and fails when `.node-version` or `packageManager` differs from the runner's.
- [x] 2.12 Every commit on `main` after this change either matches a merged pull
      request commit or is by `torrent-tv-release[bot]` with a header ending in
      `#ttv-386`, `#ttv-387` or `#ttv-388` and only the paths of design.md.
      Every `force_push` has actor `torrent-tv-release[bot]`. `git grep -n
      'HEAD:refs/heads/main' -- .github/workflows` finds two lines: the force-push of
      `version` and the push of `dependencies.yml`.
      Shown: every commit after 059c0ee is a merged pull request commit or one of the release
      App's 8 commits `chore(deploy): run server <v> #ttv-388` (v0.66.54 to v0.66.61), each
      changing `docker-compose.yml` and the version files; all 16 `force_push` entries since the
      switch merge (infra#11, 2026-11-10 14:59:33 UTC) are by `torrent-tv-release[bot]`, the
      others are 8 `pr_merge` by the coordinator and 8 `push` by the release App. `git grep -n
      'HEAD:refs/heads/main' -- .github/workflows` is the force-push of `version` and the push
      of `dependencies.yml` (meta#336 comment 6781047118, AC 5, checked again against
      `origin/main` 535d6f7).
- [x] 2.14 The copy check compares each commit of a pull request with the whole history of `main`,
      and a changeset must be one plain sentence. Check: `bash scripts/check.sh changesets-selftest`
      exits 0 (the earlier range comparison passes the copy, `copies` fails it; each format rule fails
      its bad input), and the step "Changeset checks fail on bad input" passes in `Checks`.
- [x] 2.15 The step "Test every commit, oldest first" of `dependencies.yml` runs `.githooks/commit-msg` on
      each prepared commit and stops at a refused one. Check: in a scratch repository with a stub `npm` and
      a stub `scripts/check.sh`, the step keeps the commit before one whose body has a line of 120
      characters and stops there, and passes a commit made by the helper `commit` (folded body); the leg
      `commit-msg-bot` of the next commit runs exactly that.
- [x] 2.16 The workflow files are checked: `workflow-pins`, `workflow-tokens`, `commit-msg-bot` and their proof on
      bad input. Check: `bash scripts/check.sh workflow-selftest` exits 0, the three legs exit 0 on `main`,
      and the steps "Workflow tools are pinned exactly", "The dependency job gives no token to package
      code, and each pushing job holds its own", "The dependency job refuses a commit message the hook
      refuses" and "Workflow checks fail on bad input" pass in `Checks`.

## 3. Test plan of the closing stage: the dependency job starts from the tip of main (2026-11-11)

Change of the stage: the job `update` of `.github/workflows/dependencies.yml` checks out `main`
(`ref: main`), so a run queued by `concurrency: dependencies` does not start from the commit that was
`github.sha` when it was started (AC-REF). The defect, with its measurements: ha-addon runs 43013341200
and 43014115480 (2026-11-11). The second one was queued behind the first, checked out the dispatch-time
commit, had its push refused, its rebase stopped on `torrent_tv_proxy` package files, and it ended
`failure`; proxy 2.107.95 reached the add-on only by a manual run. The same file is in proxy, server,
ha-addon and infra.

1. Scope and risk. In scope: the leg `workflow-refs` of `scripts/check.sh` and its synthetic cases in
   `workflow-selftest`, both in the block "The checks of the workflow files", which is byte-identical in the
   four repositories. Out of scope: the checkout of the job `push` (it takes `needs.update.outputs.base`,
   the commit the patches were made on, on purpose), the other legs (unchanged), and the behaviour of
   GitHub's `concurrency` (a platform fact, not our code). Risk is low: no torrent startup, no runtime
   code; a wrong leg either lets a stale checkout through (the defect) or refuses a correct file. Depth:
   one positive case and every negative form listed in part 3, each refusal proved by its own message.
2. Level and command (unit of the shell leg, with the fixtures built by `yq` in a scratch directory):
   `bash scripts/check.sh workflow-refs` (the real file) and `bash scripts/check.sh workflow-selftest`
   (the proof that the leg fails on bad input and passes on good). The runner needs `yq` at the
   `YQ_VERSION` of the script. Exit is `bash scripts/check.sh all`, the command `dependencies.yml` and
   `main.yml` run.
3. Cases, each one `refs_case pass|fail` in `workflow_selftest`. Positive: `ref: main` on the `update`
   checkout while the `push` checkout keeps its own ref. Negative: the `update` checkout with no `ref`;
   with `${{ github.sha }}`; with `${{ github.ref }}`; with another branch; with a tag; with an empty `ref`;
   a second `update` checkout with no `ref` after a first one at `main` (every checkout is read); the
   `push` checkout at `main` while the `update` one has none (the right job is read); the job `update`
   without a checkout (the error line says `has no actions/checkout step`; the matches are counted with
   `[...] | length`, because in yq 4.54.1 a string literal at the end of a pipe prints even with no match);
   a workflow without the job `update` and no `dependencies.yml` (each error line is checked). Boundary: an
   empty string and a missing key are both refused. Not covered: a checkout through a local action or a
   `git fetch` in a `run:` (the file has none; a new form is a new case with the change that adds it).
4. Rules and exit. The test commit keeps `bash scripts/check.sh all` and `workflow-selftest` green: it
   leaves the leg out of `all` and `main.yml` and has no case that runs the leg on the repository's own
   `dependencies.yml`, because that case fails until the fix. The failing demonstration is the leg called by
   name: before the fix, `bash scripts/check.sh workflow-refs` exits 1 in each repository with
   `a checkout of job update has ref "", not main`; after it, it exits 0. The synthetic cases pass already, and
   show the leg failing on bad input and passing on `ref: main`; turning the "no checkout" branch of the leg
   into `return 0` makes `workflow-selftest` fail. The implementer commit adds exactly these lines:
   1. `dependencies.yml`, the `update` checkout: `ref: main` under `with:`.
   2. `scripts/check.sh`, `all`: `workflow_tokens && workflow_refs && commit_msg_bot` in place of
      `workflow_tokens && commit_msg_bot`.
   3. `.github/workflows/main.yml`, job `checks`, after the tokens step:
      `- name: The dependency job starts from the tip of main` with
      `run: bash scripts/check.sh workflow-refs`.
   4. `scripts/check.sh`, `workflow_selftest`, first line of the cases of `refs_case`:
      `refs_case pass "this repository's file" ''`.
   The cases use no network and no file outside their scratch directory. The leg is a check, not a
   `node:test` test, so it has no `todo` marker.
