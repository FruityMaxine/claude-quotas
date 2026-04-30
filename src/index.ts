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
  monthly_limit: number;
  used_credits: number;
  utilization: number | null;
}

interface UsageResponse {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_opus?: UsageWindow;
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
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildSummary(usage: UsageResponse, subscriptionType: string | null): string {
  const lines: string[] = [];

  if (usage.five_hour) {
    const u = usage.five_hour;
    lines.push(`5-hour session: ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }

  if (usage.seven_day) {
    const u = usage.seven_day;
    lines.push(`7-day weekly:   ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }

  if (usage.seven_day_opus) {
    const u = usage.seven_day_opus;
    lines.push(`7-day Opus:     ${u.utilization}% used | resets in ${formatResetTime(u.resets_at)}`);
  }

  if (usage.extra_usage?.is_enabled) {
    const e = usage.extra_usage;
    lines.push(`Extra usage:    $${e.used_credits}/$${e.monthly_limit} (${e.utilization ?? 0}%)`);
  }

  if (subscriptionType) {
    lines.push(`Subscription:   ${subscriptionType}`);
  }

  return lines.join("\n");
}

// --- MCP Server Setup ---

const server = new McpServer({
  name: "claude-quotas",
  version: "1.0.0",
});

server.tool("check_quota", "Check current Claude subscription quota usage (5-hour session, 7-day weekly, Opus weekly, extra usage) and reset times", {}, async () => {
  try {
    const creds = await loadCredentials();
    const oauth = creds.claudeAiOauth;

    if (!oauth?.accessToken) {
      return {
        content: [{ type: "text", text: "Error: No Claude OAuth credentials found. Please run `claude login` first." }],
      };
    }

    if (oauth.expiresAt && Date.now() > oauth.expiresAt) {
      return {
        content: [{ type: "text", text: "Error: OAuth token has expired. Please run `claude login` to refresh." }],
      };
    }

    const usage = await fetchUsage(oauth.accessToken);
    const summary = buildSummary(usage, oauth.subscriptionType ?? null);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          subscription_type: oauth.subscriptionType ?? "unknown",
          five_hour: usage.five_hour ?? null,
          seven_day: usage.seven_day ?? null,
          seven_day_opus: usage.seven_day_opus ?? null,
          extra_usage: usage.extra_usage ?? null,
          summary,
        }, null, 2),
      }],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error checking quota: ${msg}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
