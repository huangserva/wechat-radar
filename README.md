# WeChat Radar

> 群太多，真正有价值的消息却总是被淹没。
> WeChat Radar turns noisy WeChat groups into a local-first intelligence dashboard.

[![GitHub stars](https://img.shields.io/github/stars/joeseesun/wechat-radar?style=social)](https://github.com/joeseesun/wechat-radar/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/joeseesun/wechat-radar?style=social)](https://github.com/joeseesun/wechat-radar/network/members)
[![Issues](https://img.shields.io/github/issues/joeseesun/wechat-radar)](https://github.com/joeseesun/wechat-radar/issues)
[![Last commit](https://img.shields.io/github/last-commit/joeseesun/wechat-radar)](https://github.com/joeseesun/wechat-radar/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

![WeChat Radar product preview](docs/assets/product-preview.svg)

**[中文](#中文) | [English](#english)**

---

<a name="中文"></a>

## 中文

WeChat Radar 是一个本地优先的微信群聊情报看板。它把群消息、话题、链接、@我的消息和高信号人物聚合成一个可按日期查看的工作台。

你得到的不是“聊天记录列表”，而是每天可以直接处理的情报：

- 今日优先看：消息、文章、工具、异动分区展示
- 话题雷达：用 Codex CLI 按天聚合跨群话题
- 链接情报：文章/工具资源去重，生成可读标题
- 群日报：每天活跃群可生成摘要报告，方便复制给 AI 继续处理
- 本地存储：聊天数据落到你自己的 SQLite，不上传到第三方服务
- 明暗主题：默认奶白色浅色主题，也支持深色模式

## 快速开始

```bash
git clone https://github.com/joeseesun/wechat-radar.git
cd wechat-radar
pnpm install
pnpm rebuild better-sqlite3
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次进入会跳到 `/setup`，按页面提示填写你的微信名、确认隐私说明，也可以先启用 demo 数据体验。

## 前置条件

- [ ] macOS，且已登录微信 4.x
- [ ] 建议使用注册半年以上的小号或测试号，不建议直接使用主力微信号
- [ ] 已测试微信版本：`4.1.9.58`；不建议在更高版本上贸然测试
- [ ] Node.js 20+：`node --version`
- [ ] pnpm：`corepack enable && pnpm --version`
- [ ] wx-cli：`wx --version`
- [ ] wx daemon 正在运行：`wx daemon status`
- [ ] 如果要让话题聚合更好，安装并登录 Codex CLI：`codex --version`

wx-cli 可参考原项目安装与初始化：[jackwener/wx-cli](https://github.com/jackwener/wx-cli)。

## 配置

默认数据目录是 `~/.wechat-radar/`，不会写进项目目录。

你可以用环境变量覆盖：

```bash
cp .env.example .env.local
```

常用配置：

```bash
WECHAT_RADAR_DATA_DIR=~/.wechat-radar
WECHAT_RADAR_MY_NAMES=张三,San Zhang,zhangsan
WECHAT_RADAR_DEMO=0
WECHAT_RADAR_CODEX_MODEL=
```

也可以直接在 `/setup` 页面配置。配置会写入 `~/.wechat-radar/config.json`。

## 使用方式

1. 进入首页，选择日期或时间范围。
2. 点击“重扫”同步当前范围消息。
3. 点击“全量同步”拉取更长历史。
4. 打开“话题雷达”查看跨群主题。
5. 打开“链接情报”查看文章和工具资源。
6. 在活跃群列表点击“日报”查看单群日报。

你可以这样和 AI 配合：

- “把今天所有 Codex 相关话题整理成一篇博客大纲。”
- “复制这个群日报，帮我提炼值得回复的机会。”
- “把链接情报里的工具做成一张试用优先级表。”

## 数据与隐私

WeChat Radar 默认只在本机读写数据：

- `~/.wechat-radar/radar.db`：SQLite 主数据库
- `~/.wechat-radar/config.json`：本地配置
- `~/.wechat-radar/backups/`：可选备份

安全设计：

- wx-cli 调用使用 `child_process.execFile` 参数数组，不拼 shell
- SQLite 使用 prepared statements
- 页面只以 React 文本节点渲染聊天内容
- 不把微信密钥、会话、数据库、模型缓存提交进仓库

重要风险提示：

- 建议使用注册半年以上的小号或测试号，不建议使用主力微信号。
- 当前只建议读取历史聊天记录，用于本地检索、聚合和摘要。
- 不建议读取朋友圈，也不要自动点赞、评论、发消息、加好友、改资料或做任何写入/社交操作。
- 已测试通过的微信版本是 `4.1.9.58`；不建议在更高版本上贸然测试，版本变化可能带来不可预期的账号风险。
- 请确认你的使用方式符合微信客户端规则、当地法律、群成员隐私预期和你所在组织的合规要求。
- 不要把包含真实聊天内容的数据库或截图上传到公开仓库。

## 项目结构

```text
app/                 Next.js App Router 页面与 API
components/          看板、侧边栏、图表、消息渲染组件
lib/                 wx-cli 封装、SQLite、话题/链接聚合逻辑
scripts/             本地维护脚本
docs/assets/         README 图片与公开素材
```

## 常见问题

| 问题 | 解决方法 |
| --- | --- |
| `wx daemon 未运行` | 先运行 `wx daemon start`，再刷新页面。 |
| `better-sqlite3` native 模块报错 | 运行 `pnpm rebuild better-sqlite3`。 |
| 首页没有数据 | 先完成 `/setup`，确认 `wx sessions --json` 有输出，然后点击“重扫”。 |
| 话题雷达为空 | 打开对应日期会自动构建；也可以点击“构建话题”。需要本机可运行 `codex`。 |
| 不想读取真实微信 | 在 `/setup` 勾选 demo 模式，或设置 `WECHAT_RADAR_DEMO=1`。 |

## 致谢

- [jackwener/wx-cli](https://github.com/jackwener/wx-cli)：本项目依赖它读取本机微信数据。
- [Next.js](https://nextjs.org/)、[ECharts](https://echarts.apache.org/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)。

---

<a name="english"></a>

## English

WeChat Radar is a local-first intelligence dashboard for WeChat groups. It turns noisy group chats into daily briefings, cross-group topics, link intelligence, mentions, and per-group reports.

### Features

- Daily dashboard for messages, links, tools, anomalies, and people
- Codex CLI powered topic clustering by date
- Link intelligence with generated titles and deduplication
- Per-group daily reports with copy-friendly output
- Local SQLite storage by default
- Light and dark themes

### Install

```bash
git clone https://github.com/joeseesun/wechat-radar.git
cd wechat-radar
pnpm install
pnpm rebuild better-sqlite3
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The first run redirects to `/setup`, where you can configure your WeChat display names and privacy confirmation, or enable demo mode.

### Requirements

- [ ] macOS with WeChat 4.x logged in
- [ ] Prefer a secondary/test WeChat account that has existed for at least six months
- [ ] Tested WeChat version: `4.1.9.58`; newer versions are not recommended for unverified testing
- [ ] Node.js 20+
- [ ] pnpm
- [ ] wx-cli initialized and running
- [ ] Optional: Codex CLI for better topic/link summaries

### Privacy

By default, runtime data is stored locally under `~/.wechat-radar/`. The app does not upload your chat database. You are responsible for using it in a way that respects WeChat rules, local laws, group privacy expectations, and organizational compliance.

Safety guidance:

- Prefer a secondary or test WeChat account that has existed for at least six months.
- Use this project for read-only historical chat access.
- Do not use it for Moments, likes, comments, sending messages, adding friends, profile changes, or any other write/social action.
- The tested WeChat version is `4.1.9.58`; newer versions may carry unknown account risk and are not recommended for unverified testing.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| wx daemon is not running | Run `wx daemon start`. |
| better-sqlite3 fails to load | Run `pnpm rebuild better-sqlite3`. |
| No dashboard data | Finish `/setup`, confirm `wx sessions --json` works, then click rescan. |
| Topic radar is empty | Open the date or click build topics; make sure `codex` is available. |

## License

MIT
