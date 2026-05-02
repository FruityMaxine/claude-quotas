import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredentials, fetchUsage, buildSummary } from "./lib.js";

const server = new McpServer({
  name: "claude-quotas",
  version: "1.4.0",
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
