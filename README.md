# claude-quotas

A Claude Code plugin that lets Claude check its own subscription quota in real time — so it knows when to warn you before running out mid-task.

一个 Claude Code 插件，让 Claude 能够实时查看自己的订阅额度，在任务执行中额度即将耗尽时提前预警。

---

## What it does / 功能介绍

This plugin gives Claude a `check_quota` tool that queries the Anthropic usage API and returns:

本插件为 Claude 提供了一个 `check_quota` 工具，查询 Anthropic 用量 API 并返回：

- **5-hour session** utilization & reset time / 5小时会话窗口使用率和重置时间
- **7-day weekly** utilization & reset time / 7天周额度使用率和重置时间
- **7-day Opus** utilization (if applicable) / 7天 Opus 专用额度（如适用）
- **Extra usage** status / 额外用量状态
- **Subscription type** / 订阅类型

## Why / 为什么需要这个

Claude Code has a rolling 5-hour session limit and a 7-day weekly cap. When quota runs out mid-task, the session stops abruptly. This plugin lets Claude proactively check its remaining quota and warn you before that happens.

Claude Code 有滚动的5小时会话限制和7天周额度上限。当额度在任务中途耗尽时，会话会突然中断。这个插件让 Claude 能主动检查剩余额度，在耗尽前提前预警。

## Install / 安装

### From GitHub / 从 GitHub 安装

```bash
claude plugins add github:FruityMaxine/claude-quotas
```

### As MCP server (alternative) / 作为 MCP 服务器（备选）

```bash
claude mcp add claude-quotas -- npx -y claude-quotas
```

### From source / 从源码安装

```bash
git clone https://github.com/FruityMaxine/claude-quotas.git
cd claude-quotas
npm install && npm run build
claude --plugin-dir ./claude-quotas
```

## Usage / 使用方法

Once installed, Claude gains access to the `check_quota` tool. You can:

安装后，Claude 获得 `check_quota` 工具。你可以：

- Ask Claude directly: "Check your quota" / 直接问 Claude："查看你的额度"
- Use the skill command: `/claude-quotas:check-quota` / 使用技能命令

Claude will return a summary like:

```
5-hour session: 38% used | resets in 2h 15m
7-day weekly:   87% used | resets in 3d 4h
Subscription:   max_5x
```

## Warning thresholds / 预警阈值

The plugin includes built-in warning thresholds based on subscription type:

插件内置了基于订阅类型的预警阈值：

| Subscription / 订阅 | Warn at / 预警阈值 | Remaining / 剩余 |
|---------------------|--------------------|--------------------|
| Pro (1x) | 80% used | 20% left |
| Max 5x | 96% used | 4% left |
| Max 20x | 98% used | 2% left |

## How it works / 工作原理

1. Reads your local Claude Code OAuth credentials (`~/.claude/.credentials.json`)
2. Calls the Anthropic usage API (`GET https://api.anthropic.com/api/oauth/usage`)
3. Returns structured quota data via MCP tool

读取本地 Claude Code OAuth 凭证，调用 Anthropic 用量 API，通过 MCP 工具返回结构化的额度数据。

No extra login required — uses your existing Claude Code session.

无需额外登录，直接使用你现有的 Claude Code 会话。

## Requirements / 要求

- Claude Code (authenticated / 已登录)
- Node.js >= 18

## License / 许可证

MIT — see [LICENSE](LICENSE)

## Author / 作者

[FruityMaxine](https://github.com/FruityMaxine)
