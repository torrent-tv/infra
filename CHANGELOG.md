# torrent-tv-infra

## 0.0.21

### Patch Changes

- The dependency workflow now starts from the newest commit of main, so a run that waited in the queue no longer fails on a conflict with the run before it.

## 0.0.20

### Patch Changes

- Run server 0.66.64 in server-a.

## 0.0.19

### Patch Changes

- Run server 0.66.63 in server-b.

## 0.0.18

### Patch Changes

- Run server 0.66.62 in server-a.

## 0.0.17

### Patch Changes

- The OpenSpec change for the release flow is archived.

## 0.0.16

### Patch Changes

- Run server 0.66.61 in server-b.

## 0.0.15

### Patch Changes

- The dependency job now refuses a commit whose message the commit-msg hook refuses, and CI checks the exact pins, the tokens and the commit messages of the workflow files.

## 0.0.14

### Patch Changes

- Run server 0.66.60 in server-a.

## 0.0.13

### Patch Changes

- Run server 0.66.59 in server-b.

## 0.0.12

### Patch Changes

- Run server 0.66.58 in server-a.

## 0.0.11

### Patch Changes

- A version whose commit changes a workflow file is tagged and released again: the release job now pushes its tag with a token that may touch workflow files.

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
