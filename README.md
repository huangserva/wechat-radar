# WeChat Radar

WeChat Radar is a local-first WeChat group intelligence cockpit. It reads the decrypted Hermes `wechat-assistant` data products, syncs them into a private `radar.db`, and turns group chats, links, topics, commitments, people, knowledge, reviews, and lab analyses into a fast browser dashboard.

Repository:

```text
https://github.com/huangserva/wechat-radar
```

## Core Features

### Local Data Layer

- Default source: Hermes `wechat-assistant` decrypted outputs, especially `collector.db` and `decrypted/*.db`.
- App cache: `~/.wechat-radar/radar.db`, built by sync scripts and read by the dashboard.
- Scale target: real local datasets in the 770k-message class, with FTS5 full-text search over messages.
- Legacy `wx` / wx-daemon path is still present, but the default production path is DB-first.

### Cockpit Panels

- `/` dashboard: urgent steward todos, key messages, group activity, links, and intelligence brief.
- `/topics`: topic radar, topic trends, warming/cooling scores, and cross-week sparklines.
- `/hotspots`: trending discussion topics and source-group chips.
- `/links`: link intelligence, deduped article/tool/resource views, and safe external links.
- `/commitments`: todos, calendar items, urgent/open/expired filters, and contact filters.
- `/people`: people cockpit, identity-boundary notice, profile background, knowledge contribution, and activity deltas.
- `/profile`: owner profile, six dimensions, conclusions, confidence, source counts, and snapshot history.
- `/knowledge`: knowledge items, category/tag filters, and tag co-occurrence graph.
- `/insights`: hot topic rankings, most-shared links, weekly events, and topic evolution threads.
- `/reviews`: retrospective view with stale/empty data called out honestly.
- `/lab`: conversation lab with five analysis modes, history replay, evidence jump-back, profile consent, and trend tab.
- `/steward`, `/silence`, `/feedback`, `/mentions`, `/groups`, `/signals`, `/classify`: operational views for queue, silence, push feedback, mentions, group details, signals, and classification.

### Conversation Lab

`/lab` supports five modes: family, couple, workplace, social, and parent-child. It reads real chat history, requires explicit consent before sending selected messages to an LLM provider, supports custom dimensions, profile context opt-in, cached historical runs, evidence snippets, and group-message jump-back.

Supported LLM paths are openai-compatible providers such as MiMo or GLM, with Codex CLI fallback where configured.

### Derived Analysis

The local pipeline derives:

- topics and topic trends
- links and link dedupe/title enrichment
- silence and group vitality
- cross-group influence
- reply networks
- member activity deltas
- push feedback
- knowledge categories and tag co-occurrence

## Data Flow

```text
Hermes wechat-assistant
  collector.db + decrypted/session/contact/message DBs
    -> scripts/sync-collector.ts
      -> ~/.wechat-radar/radar.db
        -> Next.js API routes and cockpit panels

Hermes assistant.db / JSON artifacts
  digests, todos, knowledge, topics, profile, user_state
    -> read-only source adapters
      -> knowledge, insights, commitments, people, profile, steward panels
```

The app reads private data from local disk. It does not require a hosted backend.

## Quick Start

```bash
git clone git@github.com:huangserva/wechat-radar.git
cd wechat-radar
pnpm install
pnpm rebuild better-sqlite3
cp .env.example .env.local
$EDITOR .env.local
pnpm dev
```

Open:

```text
http://localhost:3000
```

First-time setup is available at `/setup`.

## Configuration

Private config belongs in `.env.local`; never commit real keys, local DB paths, or chat exports.

Start from:

```bash
cp .env.example .env.local
```

Important groups:

- data paths: `WECHAT_RADAR_DATA_DIR`, `WECHAT_RADAR_WECHAT_ASSISTANT_DIR`, `WECHAT_RADAR_COLLECTOR_DB`, `WECHAT_RADAR_DECRYPTED_DIR`
- identity: `WECHAT_RADAR_SELF_WXID`, `WECHAT_RADAR_MY_NAMES`
- data source: `WECHAT_RADAR_DATA_SOURCE=db`
- lab provider: `WECHAT_RADAR_LAB_PROVIDER`, `WECHAT_RADAR_LAB_BASE_URL`, `WECHAT_RADAR_LAB_API_KEY`, `WECHAT_RADAR_LAB_MODEL`
- topic/link LLM tuning: `WECHAT_RADAR_TOPIC_*`, `WECHAT_RADAR_LINK_*`
- sync windows: `WECHAT_RADAR_AUTO_TOPIC_DAYS`

See `.env.example` for all configurable environment variables and defaults.

## Scripts

```bash
pnpm dev
pnpm build
pnpm start
pnpm test
pnpm db:backup
pnpm demo:seed
```

Maintenance and analysis scripts:

- `scripts/sync-collector.ts`: sync Hermes `collector.db` into `~/.wechat-radar/radar.db`.
- `scripts/run-topics-links.ts`: run topic and link extraction/enrichment over recent messages.
- `scripts/migrate-fts5.ts`: create or repair FTS5 search indexes.
- `scripts/classify-knowledge.ts`: classify extracted knowledge items with the configured LLM provider.
- `scripts/infer-push-feedback.ts`: infer push/notification feedback signals from local data.
- `scripts/backfill_empty_groups.cjs`: repair missing group metadata.
- `scripts/backup-cockpit-db.mjs`: backup local cockpit DB.
- `scripts/seed_demo.cjs`: seed demo-only data; do not run against a real data directory unless intentional.

Typical direct invocation:

```bash
pnpm exec tsx scripts/sync-collector.ts
pnpm exec tsx scripts/run-topics-links.ts
pnpm exec tsx scripts/migrate-fts5.ts
```

## Tech Stack

- Next.js 16 App Router + Turbopack
- React 19
- better-sqlite3
- SQLite / FTS5
- Tailwind CSS 4
- lucide-react
- openai-compatible LLM providers, including MiMo and GLM-compatible endpoints

## Privacy

WeChat Radar is designed for private, local use:

- Real WeChat and assistant databases stay outside the repo.
- Runtime state defaults to `~/.wechat-radar`.
- `.env.local`, SQLite DBs, logs, screenshots, exports, and `.hive/` are gitignored.
- External links are passed through safe-url handling.
- LLM analysis is optional and should be treated as explicit data egress.
- The profile panel describes the owner/user from their own message history; it is qualitative, not an objective score.

Do not upload private chat databases, API keys, or screenshots containing personal data.

## Repository Layout

```text
app/          Next.js pages and API routes
components/   Shared cockpit UI
lib/          SQLite adapters, source readers, analysis logic, lab logic
scripts/      Local sync, migration, enrichment, and maintenance tasks
docs/         Public documentation assets
```

## Status

This is an active local-first cockpit for Huang Serva's WeChat intelligence workflow. It is not a hosted SaaS, and new users should review `.env.example`, privacy boundaries, and local data paths before running it on real chat data.

## License

MIT
