// SessionStart hook (matcher: resume) — runs check_quota and injects the
// result as additional context so Claude sees its quota state immediately
// on wake-up, without depending on the LLM remembering to call the tool.
//
// On any failure (missing creds, expired token, network, parse error) this
// script exits 0 silently — SessionStart hooks must NEVER block startup.

import { loadCredentials, fetchUsage, buildSummary } from "./lib.js";

async function main(): Promise<void> {
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
      "[claude-quotas] Session resumed — fresh quota baseline auto-injected by the claude-quotas plugin:",
      "",
      summary,
      "",
      "This is a fresh check_quota reading taken at session resume. The 5-hour window may have reset (or not) since you last paused. Apply the vigilance policy in the claude-quotas:check-quota skill: if the relevant window is still in the sleep zone for your plan tier, ScheduleWakeup again; otherwise resume the original task from where you paused.",
    ].join("\n");

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    }));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}

await main();
