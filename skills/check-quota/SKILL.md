---
description: Provides a read-only `check_quota` tool that reports the user's current Claude Code quota utilization. Invoke ONLY when the user explicitly asks about quota / remaining usage / rate limits, or when they have explicitly told you to check before a long task. Do not invoke proactively, do not poll, and do not interrupt the user with unsolicited quota warnings.
---

# claude-quotas — `check_quota`

This plugin exposes a single MCP tool, `check_quota`, that reads the user's
local Claude Code OAuth credentials and queries the Anthropic OAuth usage API.
It returns the current utilization of every quota window the API exposes, plus
human-readable summary text.

## Tool: `check_quota`

- **Type**: read-only, no arguments
- **Side effects**: one outbound HTTPS request to `api.anthropic.com`, nothing
  written to disk, no caching, no telemetry
- **Latency**: typically under 500 ms
- **Returns**: a single JSON-shaped text block with the structure described below

## When to invoke (be conservative)

Invoke `check_quota` **only** when one of these is true:

1. The user explicitly asks about their quota, remaining usage, rate limits,
   reset times, or how much budget they have left.
2. The user explicitly tells you to check before starting a specific task
   (e.g. "check my quota first, then start the migration").
3. The user binds a slash command or workflow that calls this tool.

Do **not** invoke when:

- Starting a long task on your own initiative (the user did not ask).
- Recovering from any error or unexpected state.
- "Just to be safe" before an edit, a search, a build, or a test.
- Periodically / on a timer / on every Nth message.

When in doubt, do not call it. Quota checks have a small but nonzero token
cost and the user can ask any time.

## Return shape

The tool returns a JSON object as text. Fields:

| Field | Type | Notes |
|-------|------|-------|
| `subscription_type` | string | Coarse plan name from the API: `"pro"`, `"max"`. |
| `rate_limit_tier` | string \| null | Fine-grained tier from local credentials, e.g. `"default_claude_max_5x"`, `"default_claude_max_20x"`. Prefer this over `subscription_type` when describing the plan to the user. |
| `five_hour` | `{ utilization, resets_at }` \| null | Rolling 5-hour session window. `utilization` is 0–100 (percent). |
| `seven_day` | `{ utilization, resets_at }` \| null | Rolling 7-day weekly cap across all models. |
| `seven_day_opus` | `{ utilization, resets_at }` \| null | Opus-specific weekly window. Often null on plans without a separate Opus pool. |
| `seven_day_sonnet` | `{ utilization, resets_at }` \| null | Sonnet-specific weekly window. Often inactive (utilization 0, resets_at null) on plans without a separate Sonnet pool. |
| `extra_usage` | object \| null | Pay-as-you-go credit status; only meaningful when `is_enabled: true`. |
| `summary` | string | Pre-formatted multi-line human-readable summary suitable for showing the user. |

Utilization is always already normalized to the user's plan — 80% means
"80% of this user's plan budget", regardless of whether they're on Pro,
Max 5x, or Max 20x. You do not need to know absolute token counts.

## How to present results

If the user asked, just show them. The pre-formatted `summary` string is
designed to be relayed verbatim or lightly reformatted. For example:

```text
5-hour session: 38% used | resets in 2h 15m
7-day weekly:   87% used | resets in 3d 4h
Plan:           max 5x
```

If they asked a specific question ("how much weekly do I have left?"), answer
that specific question from the JSON; do not dump the whole object.

## Optional soft warning (non-blocking)

After **already** invoking the tool because the user asked, you *may* add a
single brief sentence if utilization on either `five_hour` or `seven_day` is
**≥ 90%** — e.g. "(heads up: weekly is close to the cap)". Treat this as an
optional courtesy, not a duty.

Rules for the soft warning:

- Only after a tool call the user already requested. Never trigger a check
  *because* you want to warn.
- One sentence, then stop. Do not lecture, do not propose plans, do not pause
  the current task.
- Do not repeat the warning on follow-up turns in the same session unless the
  user asks again.
- Below 90%, say nothing about thresholds. Just answer what they asked.

## Errors are non-critical

If the tool returns an error string (missing credentials, expired token,
network failure, API non-200), treat it as **non-fatal and silent**:

- Do not retry.
- Do not interrupt the user's current task to surface the error.
- Do not propose troubleshooting steps unless the user explicitly asked
  to check quota in the first place.
- If they did explicitly ask, relay the error briefly and suggest
  `claude login` only if the error mentions auth.

The user's primary task always takes precedence over this tool's health.

## Privacy note

This tool reads only `~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR`)
and sends a single request to `api.anthropic.com`. No third-party servers,
no logging, no caching. Source: ~150 lines, see `src/index.ts` in the plugin
repo.
