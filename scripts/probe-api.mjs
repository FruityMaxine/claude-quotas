import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const path = join(homedir(), ".claude", ".credentials.json");
const creds = JSON.parse(await readFile(path, "utf-8"));
const token = creds.claudeAiOauth.accessToken;

console.error("== local credential metadata ==");
console.error(JSON.stringify({
  subscriptionType: creds.claudeAiOauth.subscriptionType,
  rateLimitTier: creds.claudeAiOauth.rateLimitTier,
  scopes: creds.claudeAiOauth.scopes,
  expiresInDays: creds.claudeAiOauth.expiresAt
    ? Math.round((creds.claudeAiOauth.expiresAt - Date.now()) / 86400000)
    : null,
}, null, 2));

const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
  headers: {
    Authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    Accept: "application/json",
  },
});

console.error("\n== HTTP status:", r.status, "==");
console.error("== response headers ==");
for (const [k, v] of r.headers.entries()) {
  if (k.startsWith("x-") || k.startsWith("anthropic-") || k === "content-type") {
    console.error(`  ${k}: ${v}`);
  }
}

const json = await r.json();
console.error("\n== raw response body ==");
console.log(JSON.stringify(json, null, 2));
