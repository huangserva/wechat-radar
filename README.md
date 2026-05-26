# WeChat Radar

> Local-first WeChat intelligence cockpit.

WeChat Radar turns local WeChat data into a private dashboard for group intelligence, relationship analysis, topics, links, signals, commitments, reviews, and knowledge traces.

This repository is maintained at:

`https://github.com/huangserva/wechat-radar`

## What It Is

WeChat Radar is not a cloud product and not a bot. It is a local-first cockpit for reading already available local WeChat data and turning it into structured intelligence.

Current focus:

- Home dashboard: message volume, active groups, categories, daily trend, and intelligence brief
- Groups: group-level activity, search, and daily review entry points
- People: high-signal people and interaction patterns
- Mentions: messages that mention you or configured names
- Links: extracted links, article/tool/resource signals, and safe URL handling
- Topics: cross-group topic aggregation
- Signals: high-value message signals and abnormal activity
- Hotspots: active discussion clusters
- Commitments: promised actions, follow-ups, and pending items
- Knowledge: reusable facts and accumulated context
- Reviews: retrospective views for groups and time ranges
- Classify: group/message classification workflow
- Lab: LLM-assisted relationship and communication analysis with consent gate

## Data Source

The default data source is decrypted local database output from the Hermes `wechat-assistant` workflow:

```text
~/wechat-assistant/
├── collector.db
└── decrypted/
    ├── session/session.db
    ├── contact/contact.db
    └── message/message_*.db
```

The app reads these local files and builds its own local cache under:

```text
~/.wechat-radar/
├── config.json
└── radar.db
```

Legacy `wx` mode still exists, but it is not the primary path now:

```bash
WECHAT_RADAR_DATA_SOURCE=wx
```

## Quick Start

```bash
git clone git@github.com:huangserva/wechat-radar.git
cd wechat-radar
pnpm install
pnpm rebuild better-sqlite3
cp .env.example .env.local
pnpm dev
```

Open:

```text
http://localhost:3000
```

First run goes through `/setup`.

## Configuration

Use `.env.local` for private local config. Do not commit it.

Important options:

```bash
# Optional. Defaults to ~/.wechat-radar
WECHAT_RADAR_DATA_DIR=

# Names used to detect messages that mention you.
WECHAT_RADAR_MY_NAMES=张三,San Zhang,zhangsan

# Default: db. Use wx only for legacy wx-cli mode.
WECHAT_RADAR_DATA_SOURCE=db

# Defaults to ~/wechat-assistant
WECHAT_RADAR_WECHAT_ASSISTANT_DIR=
WECHAT_RADAR_COLLECTOR_DB=
WECHAT_RADAR_DECRYPTED_DIR=

# Optional, used when raw decrypted message DB needs your own wxid.
WECHAT_RADAR_SELF_WXID=

# Optional /lab LLM provider.
WECHAT_RADAR_LAB_PROVIDER=openai-compatible
WECHAT_RADAR_LAB_BASE_URL=
WECHAT_RADAR_LAB_API_KEY=
WECHAT_RADAR_LAB_MODEL=

# Optional Codex CLI summarization tuning.
WECHAT_RADAR_CODEX_MODEL=
WECHAT_RADAR_TOPIC_CHUNK_SIZE=250
WECHAT_RADAR_CODEX_TIMEOUT_MS=300000
WECHAT_RADAR_LINK_CODEX_TIMEOUT_MS=180000
WECHAT_RADAR_AUTO_TOPIC_DAYS=31
```

`.env.example` contains placeholders only. Real keys and local paths belong in `.env.local`.

## Commands

```bash
pnpm dev          # start Next.js dev server
pnpm build        # production build
pnpm start        # run built app
pnpm test         # lightweight local tests
pnpm demo:seed    # seed demo data
pnpm db:backup    # backup local cockpit DB
```

## Privacy And Safety

This project handles sensitive local chat data. Treat it as private infrastructure.

Do not commit or upload:

- `.env.local`
- `radar.db`
- `*.db`, `*.sqlite`, `*.sqlite3`
- `.next/`
- `node_modules/`
- `.hive/`
- logs, screenshots, exports, or any file containing real chat content

The repository `.gitignore` already excludes these paths.

Security boundaries:

- Local-first by default
- Runtime data stored under `~/.wechat-radar`
- Real WeChat/assistant databases stay outside the repo
- SQLite queries use prepared statements
- Chat content is rendered as text, not injected as HTML
- Optional LLM workflows must be treated as explicit data egress

Account and compliance notes:

- Prefer a secondary/test WeChat account.
- Use read-only historical data workflows.
- Do not automate sending messages, adding friends, profile changes, likes, comments, or other social/write actions.
- Make sure your usage respects platform rules, local law, group privacy expectations, and organizational compliance.

## Repository Layout

```text
app/                 Next.js App Router pages and API routes
components/          Dashboard, charts, layout, message rendering
lib/                 Data adapters, SQLite access, intelligence pipeline, lab logic
scripts/             Local maintenance scripts
docs/assets/         Public README/product assets
```

## Key Local Files

```text
.env.example         Public config template
.env.local           Private config, ignored
radar.db             Local runtime DB if created in repo, ignored
~/.wechat-radar      Default app state directory
~/wechat-assistant   Default decrypted WeChat source directory
```

## Status

This is an active local-first experiment, not a hosted SaaS. The current codebase is optimized for Huang Serva's local WeChat intelligence workflow and may need adaptation before general use.

## License

MIT
