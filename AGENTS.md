# AGENTS.md

Fork of [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (module `github.com/router-for-me/CLIProxyAPI/v8`) maintained on a clean-upstream baseline. The only downstream feature is the CodeBuddy provider (see `docs/CODEBUDDY.md`).

## Repository Layout
- Remotes: `origin` = `hgqapp/CLIProxyAPI` (this fork), `upstream` = `router-for-me/CLIProxyAPI`, `hsn` = `HsnSaboor/CLIProxyAPIPlus` (legacy reference, read-only)
- Local archive branches: `legacy/v7` (old entangled history), `merge-v8-snapshot` (v8 migration snapshot, reference only)
- `main` = upstream `main` + a small number of CodeBuddy commits. Keep it that way: **never merge `hsn` or `legacy/v7` back in**.

## Commands
```bash
gofmt -w .
go build ./...                 # must pass before any commit
go test ./...                  # known baseline failures are listed in docs/CODEBUDDY.md
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o cli-proxy-api-plus.new ./cmd/server   # deploy build
```
Note: `-ldflags -X` version injection does not work with this toolchain; to bake a version, temporarily edit the defaults in `cmd/server/main.go` (`Version`/`Commit`/`BuildDate`), build, then `git checkout -- cmd/server/main.go`.

## Syncing Upstream (full release loop)

```bash
# 1. Rebase onto the latest upstream
git fetch upstream --prune
git rebase upstream/main       # resolve conflicts only in CodeBuddy mount points (see docs/CODEBUDDY.md)
# The rebase should only ever touch CodeBuddy files. If it touches anything else, stop and re-check.

# 2. Verify
go build ./... && go test ./sdk/auth/ ./internal/auth/codebuddy/ ./internal/runtime/executor/ ./internal/registry/

# 3. Bump tag: upstream base moved (e.g. v8.0.10) -> v8.0.10-1; same base -> increment suffix (-1 -> -2)

# 4. Push main (+ tag). Direct git push usually times out on this network; use the gh-api bridge:
node scripts/push-fork.js v8.0.10-1        # add --force after a rebase that rewrote history

# 5. Deploy per the server's ~/cliproxyapi-plus/DEPLOY_NOTES.md
#    (cross-compile -> upload .new -> stop old PID -> swap -> restart -> smoke test glm-5.3-flash)
```

## Code Conventions
- Follow upstream conventions (English comments, logrus, no `log.Fatal`, no new timeouts after upstream connection).
- CodeBuddy changes stay additive: new files preferred; mount-point edits kept to a few lines each.
- Never re-enable CodeBuddy auto token refresh in `sdk/auth/codebuddy.go` / `codebuddy_intl.go` — rotation is owned by the external check-in service (rationale in `docs/CODEBUDDY.md`).

## Deploy
Deploy target, paths, and token-sync cron live on the server in `~/cliproxyapi-plus/DEPLOY_NOTES.md` (not committed — contains private details). General flow: cross-compile → upload as `cli-proxy-api-plus.new` → stop old PID → swap → restart → verify `/v1/models` and a CodeBuddy smoke request.
