---
description: Provides a `check_quota` MCP tool plus a vigilance policy. ALWAYS INVOKE this skill and call check_quota at the START of every task to take a baseline reading — no exceptions, regardless of task size. Once invoked, follow the per-plan thresholds inside to decide when to enter alert mode, when to wrap up gracefully, and when to ScheduleWakeup-sleep across a quota reset rather than risk a mid-task interruption. Re-check periodically during the task; calibrate frequency by burn rate.
---

# claude-quotas — `check_quota` + vigilance policy

This plugin gives you (Claude) a read-only MCP tool, `check_quota`, plus a
disciplined policy for using it. The point is **never let the user's task get
interrupted by hitting the quota wall mid-work** — especially in long-running
or autonomous (`/loop`) tasks where the user may not be at the keyboard.

## The tool

`check_quota` is cheap, fast (~500 ms), and read-only. One outbound HTTPS
request to `api.anthropic.com`, nothing written to disk, no caching.

It returns a JSON object with these fields:

| Field | Meaning |
|-------|---------|
| `subscription_type` | Coarse plan: `"pro"` or `"max"`. |
| `rate_limit_tier` | Fine-grained tier from local credentials, e.g. `"default_claude_max_5x"`, `"default_claude_max_20x"`. **Use this to pick which threshold row applies.** |
| `five_hour.utilization` | 0–100. Percentage of the 5-hour rolling session window already consumed. |
| `five_hour.resets_at` | ISO 8601. When the 5-hour window resets. |
| `seven_day.utilization` | 0–100. Percentage of the 7-day rolling weekly cap already consumed. |
| `seven_day.resets_at` | ISO 8601. When the weekly window resets. |
| `seven_day_opus` | Opus-specific weekly window. `null` = no pool surfaced for this account; `{utilization: 0, resets_at: null}` = pool exists but no consumption in the current period. |
| `seven_day_sonnet` | Sonnet-specific weekly window. `null` = no pool surfaced for this account; `{utilization: 0, resets_at: null}` = pool exists but no consumption in the current period. |
| `extra_usage` | Pay-as-you-go credit status; only meaningful when `is_enabled: true`. |
| `summary` | Pre-formatted multi-line human-readable summary. |

`utilization` is **percentage already used**, normalized per plan. 80% means
"this user has consumed 80% of their plan's allowance for that window".

## When to call

Call `check_quota`:

1. **At the start** of any task that looks potentially multi-step (more than a
   single trivial edit). This is your **baseline reading**.
2. **Periodically during the task**, calibrated by how fast utilization is
   growing. Cheap tasks → check every several subtasks. Expensive tasks →
   check after each subtask.
3. **Whenever crossing into a new threshold zone** (see thresholds below)
   — re-check before the next subtask to confirm the zone.
4. **Anytime the user asks** about quota / remaining / rate limits / reset.

Do NOT use the cost of calling this tool as an excuse to skip — it is cheap
on purpose. Skipping vigilance is more expensive than calling it.

## Threshold zones (tier-aware)

Look at `rate_limit_tier`. Then apply the matching row.

### 5-hour window — by `utilization` (already-used %)

| Tier | Alert zone | Sleep + Wrap-up zone |
|------|------------|----------------------|
| `default_claude_pro` (Pro) | `utilization ≥ 70%` | `utilization ≥ 95%` |
| `default_claude_max_5x` (Max 5x) | `utilization ≥ 94%` | `utilization ≥ 98%` |
| `default_claude_max_20x` (Max 20x) | `utilization ≥ 95%` | `utilization ≥ 99%` |

### 7-day window — by `utilization` (already-used %)

| Tier | Alert zone | Wrap-up zone |
|------|------------|--------------|
| `default_claude_pro` (Pro) | `utilization ≥ 95%` | `utilization ≥ 99%` |
| `default_claude_max_5x` (Max 5x) | `utilization ≥ 98%` | `utilization ≥ 99%` |
| `default_claude_max_20x` (Max 20x) | `utilization ≥ 98%` | `utilization ≥ 99%` |

The 7d wrap-up zone branches into a **stop route** or a **short-sleep
route** depending on how close `seven_day.resets_at` is — see "either-
window-can-kill-you rule" and "7d wrap-up zone" sections below.

If the tier string isn't in this table (unknown plan), default to the Pro row
— it's the most conservative.

If `utilization` is reported outside `[0, 100]` (e.g. `null`, `NaN`, or out
of range), treat it as `100` and apply the most conservative zone.

## The "either-window-can-kill-you" rule

**Both windows are independent ceilings. Crossing either one ends the
session.** Take the result of `check_quota`, evaluate the 5h zone AND the 7d
zone, and **always act on the more severe one**.

The 7d wrap-up zone has two sub-routes depending on how soon the 7d window
resets — short reset (≤ 5h away) is sleep-able; long reset (> 5h away) is
not. Compute `seven_day_reset_hours = secondsUntil(seven_day.resets_at) / 3600`.

| 5h zone | 7d zone | What to do |
|---------|---------|------------|
| Baseline | Baseline | Normal work |
| Alert | Baseline | 5h alert mode |
| Baseline | Alert | 7d alert mode |
| Alert | Alert | Alert mode (either trigger is enough) |
| Sleep zone | Baseline / Alert | **5h sleep route** (see below) |
| Baseline / Alert | Wrap-up + `7d_reset > 5h` | **7d stop route** — wrap up + report, no sleep |
| Baseline / Alert | Wrap-up + `7d_reset ≤ 5h` | **7d short-sleep route** — sleep through the 7d reset |
| Sleep zone | Wrap-up + `7d_reset > 5h` | **7d stop route wins** — sleep forbidden because the 7d reset is too far away |
| Sleep zone | Wrap-up + `7d_reset ≤ 5h` | **Combined sleep** — sleep target = later of (5h reset, 7d reset) |

## Mode behaviours

### Baseline mode

Just work. Take a baseline reading at the start, then re-check after a few
subtasks to calibrate burn rate by feel. You are not predicting anything;
you are just observing how much each subtask actually costs.

### Alert mode

- Re-check `check_quota` after every subtask.
- Prefer **smaller, well-bounded subtasks**. Don't open a new "build the
  whole feature" pass.
- Continue the task — you do not bail out — but stay aware of the wall.
- Mention the situation to the user only if they ask, or in a single short
  line at the moment you transition into Alert mode if relevant. No
  repeated reminders.
- Alert mode persists until either you cross into the Sleep zone (or 7d
  stop zone), or the relevant window resets — `utilization` never decreases
  on its own.

### Sleep + Wrap-up mode (5h window crossed sleep zone)

This is the central feature of this plugin. **Goal: avoid the
mid-task quota interrupt by gracefully sleeping through the reset.**

Sequence — do **all** of these, in order:

1. **Wrap up the current minimal complete unit of work.** This means:
   - If you're mid-function: finish the function so the file compiles.
   - If you're mid-file: stop adding new functions but make sure the file
     is in a consistent compilable state.
   - If you're mid-multi-file change: complete the file you're currently
     in; do NOT start a new file.
   - **Maximize productive work — do not stop early just because you're in
     this zone. Use the remaining budget up to the wall.** The goal is the
     largest complete unit you can finish, not the smallest.
   - **Never leave the codebase in a half-broken state** (syntax error,
     unbalanced braces, missing import, half-typed function signature).
2. **Schedule the wake-up.** Compute
   `delaySeconds = max(60, secondsUntil(five_hour.resets_at) + 60)` — the
   `+ 60` is a safety buffer for off-by-a-few-seconds reset timing on the
   API side; waking one minute late is harmless, but waking one second
   early forces a wasted relay segment. The runtime caps at 3600 seconds;
   if the computed delay is longer, use 3600 and plan to relay-sleep on
   wake (see below). Call `ScheduleWakeup` with the prompt template in
   the next section. **This call ends the current turn**, so make sure
   step 1 is done first. Your prior conversation context is preserved
   into the woken turn — there is no need to write any state to disk.

#### Wake-up prompt template

When calling `ScheduleWakeup`, use this `prompt`:

```
[claude-quotas: woken from quota-protective sleep — segment 1 of up to 6]

You scheduled this wake-up to ride out a quota window (5h sleep, 7d
short-sleep, or both). On waking:

1. Call check_quota immediately. Note: this plugin ships a SessionStart
   hook that auto-injects a fresh check_quota reading on resume — the
   data may already be visible in your system reminders, in which case
   step 1 is satisfied; otherwise call the tool yourself.
2. If the windows you slept for are now out of their action zones
   (utilization below the per-plan thresholds above), continue the
   original task from where you paused — your prior conversation
   context is still available in this session.
3. If a relevant window is STILL in its action zone, the runtime probably
   capped the previous segment at 3600s. Read the segment number in this
   prompt's first line. If it is less than 6, ScheduleWakeup again with
   delaySeconds = max(60, secondsUntil(target_resets_at) + 60), where
   target_resets_at is the still-blocked window's resets_at (or the
   later of the two if you slept for both). Reuse this template, bump
   the segment number to N+1. Do not start work yet.
4. If the segment number is already 6 and a window still has not reset,
   stop and report to the user instead of sleeping again.

Original task summary: <one-line summary of the task you were doing>
```

Replace `<one-line summary>` before calling. The runtime delivers this
prompt to you on wake-up; you must read step 1 and act.

### 7d wrap-up zone — stop route OR short-sleep route

The 7-day window normally can't be slept through (resets are days away).
But if it happens to be in its last 5 hours, sleeping through is viable
just like the 5h sleep route — 5h fits within ScheduleWakeup's 6-segment
relay budget (6 × 3600s ≈ 6h).

**Decision rule**: compute `seconds_until_7d_reset = secondsUntil(seven_day.resets_at)`.

- `seconds_until_7d_reset > 5 * 3600` → **stop route** below.
- `seconds_until_7d_reset ≤ 5 * 3600` → **short-sleep route** below.

#### Stop route (7d reset more than 5h away)

1. Wrap up the current minimal complete unit (same as 5h sleep route step 1
   — leave the codebase in a compilable state).
2. **Do NOT call ScheduleWakeup.** Sleeping for days is not viable.
3. End the turn with a clear message to the user: weekly cap is at X%,
   resets in Y days. Suggested options:
   - If `extra_usage.is_enabled` is `true`, switching to extra/paid usage
     is available.
   - Otherwise, switch models or pause until the reset.

#### Short-sleep route (7d reset within 5h)

Same shape as the 5h sleep route, but the wake-up target is the 7d reset:

1. Wrap up the current minimal complete unit.
2. Compute `delaySeconds = max(60, secondsUntil(seven_day.resets_at) + 60)`.
3. Call `ScheduleWakeup` with the wake-up prompt template (see 5h sleep
   route section above) — the same template covers both 5h and 7d sleeps.

#### Combined case — both 5h sleep zone AND 7d short-sleep route apply

When both windows need sleeping in one go, target the **later** reset so
both clear:

```
delaySeconds = max(
  60,
  Math.max(
    secondsUntil(five_hour.resets_at),
    secondsUntil(seven_day.resets_at)
  ) + 60
)
```

On wake the LLM checks both windows and decides whether to relay-sleep
again or resume work.

## /loop and autonomous mode — extra strict

When you notice you are in `/loop` or any autonomous-runner context (the user
is likely not at the keyboard, possibly for hours), **be more conservative**:

- Take a baseline `check_quota` at the start of every loop iteration that
  involves real work.
- Lower the de-facto Sleep zone trigger by ~1% relative to the table above:
  - Pro: `utilization ≥ 94%` (instead of 95%)
  - Max 5x: `utilization ≥ 97%` (instead of 98%)
  - Max 20x: `utilization ≥ 98%` (instead of 99%)

  The cost of one missed wake-up is far higher than the cost of an extra
  1% safety margin.
- If you ever find yourself uncertain whether the user is at the keyboard,
  assume they are NOT. Hitting the wall in autonomous mode pops a blocking
  dialog that does not auto-dismiss when the quota resets — meaning the
  loop is dead until the user comes back. Avoiding that dialog is the
  whole point of this skill in autonomous contexts.

## Errors are non-critical

If `check_quota` returns an error string (missing/expired credentials,
network failure, API non-200), treat as **non-fatal and silent**:

- Do not retry.
- Do not interrupt the user's task to surface the error.
- Continue work as if you have no quota information.
- Only mention the error if the user explicitly asked for a quota check.

The user's primary task always takes precedence over this tool's health.

## What NOT to do

- Do not refuse a task because quota is low. The user gave you the task;
  do it. The vigilance policy adapts behaviour, it does not veto work.
- Do not interrupt with unsolicited "FYI you're at 38%" announcements.
  Silent observation, action only at thresholds.
- Do not use Bash `sleep` to wait out a quota window — Bash blocks the
  current turn and is capped at minutes, not hours. Use `ScheduleWakeup`.
- Do not write any "resume note" / progress log file to disk for the
  wake-up flow — your conversation context survives the wake-up, and
  unsolicited files in the user's project directory are noise.

## Privacy note

This tool reads only `~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR`)
and sends a single request to `api.anthropic.com`. No third-party servers,
no logging, no caching. Source: ~150 lines, see `src/index.ts` in the plugin
repo.
