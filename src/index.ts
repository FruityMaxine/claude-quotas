import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const USER_AGENT = "claude-quotas/1.0.0";

interface Credentials {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    subscriptionType?: string | null;
    rateLimitTier?: string | null;
  };
}

interface UsageWindow {
  utilization: number;
  resets_at: string | null;
}

interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
  currency?: string | null;
}

interface UsageResponse {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_opus?: UsageWindow | null;
  seven_day_sonnet?: UsageWindow | null;
  extra_usage?: ExtraUsage;
}

function getCredentialsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(configDir, ".credentials.json");
}

async function loadCredentials(): Promise<Credentials> {
  const path = getCredentialsPath();
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Credentials;
}

async function fetchUsage(token: string): Promise<UsageResponse> {
  const resp = await fetch(USAGE_API, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Usage API returned ${resp.status}: ${body}`);
  }

  return (await resp.json()) as UsageResponse;
}

function formatResetTime(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return "resetting now";
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function prettifyTier(tier: string | null): string | null {
  if (!tier) return null;
  return tier.replace(/^default_claude_/, "").replace(/_/g, " ");
}

function buildSummary(usage: UsageResponse, tier: string | null): string {
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

  if (usage.seven_day_sonnet && usage.seven_day_sonnet.utilization > 0) {
    const u = usage.seven_day_sonnet;
    lines.push(`7-day Sonnet:   ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }

  if (usage.extra_usage?.is_enabled && usage.extra_usage.monthly_limit != null) {
    const e = usage.extra_usage;
    const cur = e.currency === "usd" || !e.currency ? "$" : `${e.currency.toUpperCase()} `;
    lines.push(`Extra usage:    ${cur}${e.used_credits ?? 0}/${cur}${e.monthly_limit} (${e.utilization ?? 0}%)`);
  }

  const pretty = prettifyTier(tier);
  if (pretty) {
    lines.push(`Plan:           ${pretty}`);
  }

  return lines.join("\n");
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: "claude-quotas",
  version: "1.2.0",
});

server.tool(
  "check_quota",
  "Read-only: returns the user's current Claude Code quota utilization (5-hour session, 7-day weekly, model-specific weekly windows if active, and extra usage) plus reset times. This is a CHEAP tool you should use VIGILANTLY during multi-step tasks to avoid hitting the wall mid-work. See the check_quota skill for the full vigilance policy: take a baseline reading at the start of any potentially-long task, re-check periodically as utilization grows, and trigger graceful wrap-up + ScheduleWakeup-based sleep when crossing the per-plan thresholds. Errors from this tool are non-critical — silently skip on failure rather than interrupting the user's task.",
  {},
  async () => {
    try {
      const creds = await loadCredentials();
      const oauth = creds.claudeAiOauth;

      if (!oauth?.accessToken) {
        return {
          content: [{ type: "text", text: "claude-quotas: not authenticated (no OAuth token in ~/.claude/.credentials.json). User can run `claude login` if they want this tool to work — do not interrupt their current task to tell them." }],
        };
      }

      if (oauth.expiresAt && Date.now() > oauth.expiresAt) {
        return {
          content: [{ type: "text", text: "claude-quotas: OAuth token has expired. User can run `claude login` to refresh — do not interrupt their current task to tell them." }],
        };
      }

      const usage = await fetchUsage(oauth.accessToken);
      const tier = oauth.rateLimitTier ?? oauth.subscriptionType ?? null;
      const summary = buildSummary(usage, tier);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            subscription_type: oauth.subscriptionType ?? "unknown",
            rate_limit_tier: oauth.rateLimitTier ?? null,
            five_hour: usage.five_hour ?? null,
            seven_day: usage.seven_day ?? null,
            seven_day_opus: usage.seven_day_opus ?? null,
            seven_day_sonnet: usage.seven_day_sonnet ?? null,
            extra_usage: usage.extra_usage ?? null,
            summary,
          }, null, 2),
        }],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{
          type: "text",
          text: `claude-quotas: failed to read quota (${msg}). This is a non-critical tool — silently skip and continue with the user's task; do not retry, do not surface this error unless the user explicitly asked to check quota.`,
        }],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
