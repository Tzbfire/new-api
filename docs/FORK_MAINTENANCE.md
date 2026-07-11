# Fork maintenance and release policy

This repository is maintained as a small patch set on top of
`QuantumNous/new-api`. External integrations such as the Yaohuo OAuth adapter
remain separate services and are consumed through configuration rather than
vendored source code.

## Remotes and branches

- `origin` points to `manyou116/new-api` and is the only push target.
- `upstream` points to `https://github.com/QuantumNous/new-api.git` and is
  fetch-only.
- `upstream-sync` is an exact mirror of `upstream/main`; never add fork changes
  to it.
- `main` is the protected production integration branch.
- Product work uses short-lived `feature/*` or `fix/*` branches and atomic
  commits.

Disable pushes to the local upstream remote:

```bash
git remote set-url --push upstream DISABLED
```

## Initial GitHub setup

Before enabling scheduled synchronization:

1. Back up the current remote `main` and make the reviewed fork integration
   branch the new `main` through an explicit pull request or controlled cutover.
2. Create a fine-grained `FORK_SYNC_TOKEN` secret scoped only to this repository
   with Contents and Pull requests read/write access. A separate token is used
   because pull requests created by the default `GITHUB_TOKEN` do not trigger
   the normal pull-request validation workflow.
3. Create repository variable `FORK_UPSTREAM_SYNC_ENABLED=true`.
4. Protect `main` and require `Fork CI / backend` and `Fork CI / container`.
5. Allow merge commits for upstream synchronization; do not squash an upstream
   sync PR.
6. Disable inherited upstream publishing workflows in the GitHub Actions UI,
   especially `.github/workflows/docker-build.yml` and
   `.github/workflows/release.yml`. They target the upstream maintainer's image
   namespace and are not fork release jobs.

The scheduled workflow remains inert until the repository variable is enabled.

## Upstream synchronization

`.github/workflows/upstream-sync.yml` runs daily and can be started manually.
It fast-forwards `upstream-sync` from the official repository and opens one PR
against `main`. It never merges or deploys automatically.

For conflicts, resolve on a temporary branch without modifying the mirror:

```bash
git fetch origin upstream
git switch -c sync/upstream-YYYYMMDD origin/main
git merge origin/upstream-sync
# resolve and test
git push origin sync/upstream-YYYYMMDD
```

Open the replacement synchronization PR from that temporary branch and close
the conflicted mirror PR. Keep feature commits intact so later conflicts stay
localized to their owning feature.

## Fork images

`main` publishes:

- `ghcr.io/manyou116/new-api:edge`
- `ghcr.io/manyou116/new-api:sha-<commit>`

A `fork-v*` tag additionally publishes the tag itself and `stable`. Fork tags
must remain distinct from upstream release tags:

```bash
git tag -a fork-v1.0.0 -m "Fork release 1.0.0"
git push origin fork-v1.0.0
```

Production should pin a release tag or image digest, not `edge` or `stable`.
The image workflow publishes SBOM and provenance attestations and never uses
the upstream Docker Hub credentials or namespace.
