---
description: Check Claude subscription quota and remaining usage. Use when the user asks to check quota, or when starting a long task that might exhaust the session limit.
---

# check_quota Tool

This plugin provides the `check_quota` MCP tool. Call it to retrieve real-time quota data from the Anthropic API.

## When to use

- When the user explicitly asks to check quota / remaining usage / rate limits
- Before starting a long multi-step task (if instructed by the user)

## Return values

The tool returns a JSON object with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `subscription_type` | string | User's plan: `"pro"`, `"max_5x"`, `"max_20x"`, etc. |
| `five_hour` | object or null | 5-hour rolling session window |
| `five_hour.utilization` | number (0-100) | Percentage of 5-hour quota already consumed |
| `five_hour.resets_at` | ISO 8601 string | When this window resets |
| `seven_day` | object or null | 7-day rolling weekly window (all models) |
| `seven_day.utilization` | number (0-100) | Percentage of weekly quota already consumed |
| `seven_day.resets_at` | ISO 8601 string | When this window resets |
| `seven_day_opus` | object or null | 7-day Opus-specific window (if applicable) |
| `extra_usage` | object or null | Extra/pay-as-you-go usage status |
| `summary` | string | Human-readable summary of all quotas |

## Warning thresholds

After calling `check_quota`, evaluate the results against these thresholds based on `subscription_type`:

| Subscription | Warn when utilization >= | Remaining |
|-------------|--------------------------|-----------|
| pro | 80% | <= 20% |
| max_5x | 96% | <= 4% |
| max_20x | 98% | <= 2% |

If either `five_hour.utilization` or `seven_day.utilization` exceeds the threshold, inform the user:
- Which quota is running low (session or weekly)
- Current utilization percentage
- When it resets (from `resets_at`)
- Suggest pausing non-critical work or waiting for reset
