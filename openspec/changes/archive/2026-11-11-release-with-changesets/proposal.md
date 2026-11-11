# Proposal: Release infra with changesets, each commit versioned in place on main

Parent: torrent-tv/meta#336, stage 2 (infra). The plan is the issue's revision 4
(https://github.com/torrent-tv/meta/issues/336#issuecomment-6765817451) and its
revision 5 amendment (https://github.com/torrent-tv/meta/issues/336#issuecomment-6768238527).
proxy, server and ha-addon make the same switch in their own pull requests; this
change is the first to merge, because server's `install` job writes a changeset
into infra's `.changeset/` and proxy and server rely on infra's pattern.

## Problem

infra has no version, no tag and no release. The daily dependency run and every
server release push a commit to `main` through the shared action `push-to-main`,
which starts the main workflow by `gh workflow run`, and the digest commit has no
way to say what it changed beyond its header.

## Why

The owner decided (2026-11-10) that every repository releases from changesets:
the version lives in `package.json`, each commit that adds a changeset gets its
own version amended into it on `main`, and no release commit is ever added.
Dependency updates come from Dependabot alerts and run on a schedule, without a
pull request.

## What Changes

- A root `package.json` (`torrent-tv-infra`, private, version `0.0.0`), its lock
  file, `.npmrc` (`save-exact=true`), and `.changeset/config.json` with
  `privatePackages: { version: true, tag: true }`. Exact devDependencies:
  `@changesets/cli` 3.0.3, `npm-check-updates` 23.1.1, `semver` 7.8.6.
- `main.yml`: the new first job `version` (design.md, "The version job");
  `plan` and a matrix of `checks`; `publish` (tag and GitHub Release);
  `rebase-prs`; `deploy` only for a commit that needs no rewrite.
- `dependencies.yml` rewritten: alerts, minor updates and digests, tests on each
  prepared commit, push by the release App from a job that runs no package code.
- `scripts/check.sh` holds the compose, nginx and exact-pin checks, so that
  `main.yml` and `dependencies.yml` run the same commands.
- infra no longer calls any action of `torrent-tv/workflows`: `push-to-main` is
  replaced by the push job, and the secret scan is GitHub push protection
  (torrent-tv/meta#399).
- The server install is not here. It is steps of the `install` job in server's
  `main.yml` (owner decision, torrent-tv/meta#336), which pushes `chore(deploy):
  run server <v> #ttv-388` with a changeset to this repository's `main`.

## Capabilities

### New Capabilities

- `release`: how a commit on `main` becomes a version, a tag and a GitHub Release.
- `dependency-updates`: how alerts and updates reach `main` without a pull request.

### Modified Capabilities

- `deploy`: `deploy` runs only for a commit the `version` job found current.

## Impact

- The release App `torrent-tv-release` rewrites and force-pushes `main`. Its
  secrets (`RELEASE_APP_PRIVATE_KEY`, variable `RELEASE_APP_CLIENT_ID`) have to be
  on infra's `production` environment before the first run after the merge.
- The release App needs `workflows: write` to force-push or rebase a commit that
  changes `.github/workflows/*`; it has it since 2026-11-10, and the tokens of
  `version` and `rebase-prs` request it.
- Node 24.22.2 (`.node-version`) and npm 11.19.1 (`packageManager`) are exact.
