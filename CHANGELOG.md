# torrent-tv-infra

## 0.0.10

### Patch Changes

- A changeset that was already released can no longer come back through a pull request, and every changeset must now be one plain sentence.

## 0.0.9

### Patch Changes

- Run server 0.66.57 in server-b.

## 0.0.8

### Patch Changes

- Project rules about releases, versions and dependencies are now written once in the shared contributing guide and linked from this repository's agent rules.

## 0.0.7

### Patch Changes

- - **Fix**: The daily dependencies workflow counts the images in the fallback commit header from the list itself, so a long list no longer reports one image fewer than it updates.

## 0.0.6

### Patch Changes

- Run server 0.66.56 in server-a.

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
