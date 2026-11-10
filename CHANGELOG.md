# torrent-tv-infra

## 0.0.5

### Patch Changes

- - **Chore**: The daily dependencies workflow wraps the body of the commits it prepares to 100 characters, so the Checks no longer fail on a long update list, and gives the token that reads Dependabot alerts only to the steps that call `gh`, not to the install scripts and tests of newly resolved packages.

## 0.0.4

### Patch Changes

- Run server 0.66.55 in server-b.

## 0.0.3

### Patch Changes

- Link the shared CONTRIBUTING rules from AGENTS.md.

## 0.0.2

### Patch Changes

- Run server 0.66.54 in server-a.

## 0.0.1

### Patch Changes

- Release from changesets: each commit that adds a changeset is amended with its version on main, tagged and released, and the daily dependency run raises Dependabot alerts and updates without a pull request.
