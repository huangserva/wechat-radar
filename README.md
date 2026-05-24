# 微信雷达（WeChat Radar）

本地优先的微信群聊情报看板。它从本机 `wx-cli` 或 demo 数据中提取趋势、关键链接、行动机会、人物雷达和内容选题，帮助你从大量微信群消息里发现真正有用的信号。

## 特性

- 首页情报工作台：今日值得出手、趋势升温、异常信号、链接精选、人物雷达、内容选题。
- 链接情报：聚合最近一天出现的文章、工具和资源，按重复度和跨群扩散排序。
- 话题雷达：按日期构建跨群话题，并查看相关原始消息。
- 群列表与群详情：查看群活跃度、每日趋势、Top 发言人和完整消息。
- 本地 SQLite：默认数据目录 `~/.wechat-radar`。
- 首次启动向导：配置你的微信名、检查 `wx-cli`、确认隐私、可一键使用示例数据。

## 运行要求

- macOS
- Node.js 20+
- pnpm
- 可选：[`wx-cli`](https://github.com/jackwener/wx-cli)，用于读取本机微信数据

没有 `wx-cli` 也可以使用 demo 模式预览界面。

## 快速开始

```bash
pnpm install
pnpm rebuild better-sqlite3
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)。首次访问会进入 `/setup`。

## Demo 模式

如果你还没有配置 `wx-cli`，可以在 `/setup` 勾选“使用示例数据体验”。也可以命令行生成示例数据：

```bash
pnpm demo:seed
pnpm dev
```

示例数据会写入 `~/.wechat-radar/radar.db`。

## 配置

可以通过 `.env.local` 配置：

```env
WECHAT_RADAR_DATA_DIR=~/.wechat-radar
WECHAT_RADAR_MY_NAMES=你的微信名,你的群昵称
WECHAT_RADAR_DEMO=0
WECHAT_RADAR_CODEX_MODEL=
```

也可以在首次启动向导中配置，配置会保存在：

```text
~/.wechat-radar/config.json
```

关键配置：

| 配置 | 说明 |
|---|---|
| `WECHAT_RADAR_DATA_DIR` | 本地数据目录，默认 `~/.wechat-radar` |
| `WECHAT_RADAR_MY_NAMES` | 用于识别 @我的多个昵称，逗号分隔 |
| `WECHAT_RADAR_DEMO` | 设置为 `1` 时启用 demo 模式 |
| `WECHAT_RADAR_CODEX_MODEL` | 可选，Codex CLI 话题/链接整理使用 |

## wx-cli 接入

确认 `wx` 命令可用：

```bash
wx --version
wx daemon status
wx sessions -n 10 --json
```

如果 daemon 没运行，请按你的 `wx-cli` 文档启动或修复。

## 数据存储

默认数据目录：

```text
~/.wechat-radar/
├── radar.db
└── config.json
```

数据库包含：

- `messages`：同步后的本地消息。
- `daily_stats`：每日聚合统计。
- `mentions`：@我的索引。
- `groups` / `group_tags`：本地分组。
- `topics` / `topic_messages`：话题雷达结果。
- `link_intelligence_cache`：链接情报缓存。

不要把 `radar.db`、`.env.local` 或日志提交到 Git。

## 常用命令

```bash
pnpm dev          # 本地开发
pnpm build        # 生产构建
pnpm lint         # 代码检查
pnpm demo:seed    # 写入示例数据
```

## 隐私说明

微信雷达默认只读本机数据，并把处理结果写入本地 SQLite。项目本身不提供云端服务，也不会自动上传聊天记录。

你需要自行确认读取、保存、处理聊天数据符合当地法律、平台规则和群成员预期。更多见 [PRIVACY.md](./PRIVACY.md)。

## 开源协议

MIT，见 [LICENSE](./LICENSE)。
