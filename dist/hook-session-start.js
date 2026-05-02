#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// src/lib.ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
var USAGE_API = "https://api.anthropic.com/api/oauth/usage";
var USER_AGENT = "claude-quotas/1.4.0";
function getCredentialsPath() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(configDir, ".credentials.json");
}
async function loadCredentials() {
  const path = getCredentialsPath();
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}
async function fetchUsage(token) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8e3);
  try {
    const resp = await fetch(USAGE_API, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20"
      },
      signal: controller.signal
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Usage API returned ${resp.status}: ${body}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
function formatResetTime(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  const now = /* @__PURE__ */ new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return "resetting now";
  const totalMinutes = Math.floor(diffMs / 6e4);
  if (totalMinutes < 1) return "<1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
function prettifyTier(tier) {
  if (!tier) return null;
  return tier.replace(/^default_claude_/, "").replace(/_/g, " ");
}
function buildSummary(usage, tier) {
  const lines = [];
  if (usage.five_hour) {
    const u = usage.five_hour;
    lines.push(`5-hour session: ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }
  if (usage.seven_day) {
    const u = usage.seven_day;
    lines.push(`7-day weekly:   ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }
  if (usage.seven_day_opus && usage.seven_day_opus.resets_at) {
    const u = usage.seven_day_opus;
    lines.push(`7-day Opus:     ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }
  if (usage.seven_day_sonnet && usage.seven_day_sonnet.resets_at) {
    const u = usage.seven_day_sonnet;
    lines.push(`7-day Sonnet:   ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }
  if (usage.extra_usage?.is_enabled && usage.extra_usage.monthly_limit != null) {
    const e = usage.extra_usage;
    const cur = !e.currency || e.currency.toLowerCase() === "usd" ? "$" : `${e.currency.toUpperCase()} `;
    lines.push(`Extra usage:    ${cur}${e.used_credits ?? 0}/${cur}${e.monthly_limit} (${e.utilization ?? 0}%)`);
  }
  const pretty = prettifyTier(tier);
  if (pretty) {
    lines.push(`Plan:           ${pretty}`);
  }
  return lines.join("\n");
}

// src/hook-session-start.ts
async function main() {
  try {
    const creds = await loadCredentials();
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken) {
      process.exit(0);
    }
    if (oauth.expiresAt && Date.now() > oauth.expiresAt) {
      process.exit(0);
    }
    const usage = await fetchUsage(oauth.accessToken);
    const tier = oauth.rateLimitTier ?? oauth.subscriptionType ?? null;
    const summary = buildSummary(usage, tier);
    const additionalContext = [
      "[claude-quotas] Session resumed \u2014 fresh quota baseline auto-injected by the claude-quotas plugin:",
      "",
      summary,
      "",
      "This is a fresh check_quota reading taken at session resume. The 5-hour window may have reset (or not) since you last paused. Apply the vigilance policy in the claude-quotas:check-quota skill: if the relevant window is still in the sleep zone for your plan tier, ScheduleWakeup again; otherwise resume the original task from where you paused."
    ].join("\n");
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext
      }
    }));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
await main();
