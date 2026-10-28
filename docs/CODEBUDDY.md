# CodeBuddy Provider

CodeBuddy (腾讯 CodeBuddy / WorkBuddy, `copilot.tencent.com` API) is the only downstream feature of this fork. It was ported onto the clean v8.0.9 baseline as a set of self-contained files plus minimal mount points.

## Files

Self-contained (fork-owned, safe to carry across rebases):
- `internal/auth/codebuddy/` — OAuth (CN + Intl), token storage, errors
- `internal/cmd/codebuddy_login.go` — `-codebuddy-login` / `-codebuddy-intl-login` flows
- `internal/registry/fork_codebuddy_models.go` — model catalog (includes glm-5.3-flash, hy4-preview-f, deepseek-v4.1-flash)
- `internal/runtime/executor/codebuddy_executor.go` (+ test) — execution, streaming, headers
- `internal/runtime/executor/codebuddy_compat_deps.go` — minimal compat helper closure
- `sdk/auth/codebuddy.go`, `sdk/auth/codebuddy_intl.go` — authenticators

Mount points (the only upstream files we touch — conflict surface for rebases):
1. `cmd/server/main.go` — login flags + dispatch (4 small insertions)
2. `internal/cmd/auth_manager.go` — register `NewCodeBuddyAuthenticator()` / `NewCodeBuddyIntlAuthenticator()`
3. `sdk/cliproxy/service_models.go` — `case "codebuddy"` / `"codebuddy-intl"`
4. `sdk/cliproxy/service_executors.go` — `case "codebuddy"` / `"codebuddy-intl"`
5. `internal/registry/model_registry.go` — `ModelInfo.SupportedEndpoints` field

## Token strategy (important)

CodeBuddy refresh tokens are **single-use and rotating**: every refresh invalidates the previous refresh token. Token rotation for our deployment is owned by an external WorkBuddy check-in service which refreshes tokens only when they are within ~10 minutes of expiry (access tokens last ~28 days), and stores the latest tokens in its own account store.

Therefore auto-refresh in this codebase is **permanently disabled** (`RefreshLead` set to ~10 years in `sdk/auth/codebuddy.go` / `codebuddy_intl.go`). CLIProxyAPI only consumes the access token. A daily cron on the server syncs the freshest tokens from the check-in service's store into the CLIProxyAPI auth directory. Re-enabling auto-refresh here would race the check-in service and mutually invalidate tokens.

Upstream API facts (verified 2026-10-29):
- Both `https://copilot.tencent.com` and `https://www.codebuddy.cn` front the same `/v2/chat/completions` API; either works with a valid token.
- The gateway validates `User-Agent` (missing UA → 403); the CLI UA `CLI/2.63.2 CodeBuddy/2.63.2` passes.
- **Non-streaming chat is rejected** (`code=11101`); the executor always requests streaming upstream and aggregates for non-stream clients.

## Known baseline test failures (not caused by this fork)

`go test ./...` has a handful of failures that reproduce on pristine `upstream/main` (network-dependent discovery/pluginstore tests, a codex registry fixture test, Windows symlink-privilege tests). Compare against a clean upstream worktree before investigating.

## Credential file format

Stored in the auth dir as `<account>.json`, `type: "codebuddy"`:
```json
{
  "access_token": "...", "refresh_token": "...",
  "expires_in": 2419200, "token_type": "Bearer",
  "domain": "www.codebuddy.cn", "user_id": "<uid>",
  "email": "<account>", "type": "codebuddy", "disabled": false
}
```
`expires_in` is recomputed from the JWT `exp` at import time. Auth files are hot-reloaded by the file watcher (a restart also works).
