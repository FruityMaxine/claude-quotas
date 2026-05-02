import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
export const USER_AGENT = "claude-quotas/1.4.0";

export interface Credentials {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    subscriptionType?: string | null;
    rateLimitTier?: string | null;
  };
}

export interface UsageWindow {
  utilization: number;
  resets_at: string | null;
}

export interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
  currency?: string | null;
}

export interface UsageResponse {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  extra_usage?: ExtraUsage;
}

export function getCredentialsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(configDir, ".credentials.json");
}

export async function loadCredentials(): Promise<Credentials> {
  const path = getCredentialsPath();
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Credentials;
}

export async function fetchUsage(token: string): Promise<UsageResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(USAGE_API, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Usage API returned ${resp.status}: ${body}`);
    }

    return (await resp.json()) as UsageResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function formatResetTime(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return "resetting now";
  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes < 1) return "<1m";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function prettifyTier(tier: string | null): string | null {
  if (!tier) return null;
  return tier.replace(/^default_claude_/, "").replace(/_/g, " ");
}

export function buildSummary(usage: UsageResponse, tier: string | null): string {
  const lines: string[] = [];

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
