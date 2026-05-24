# Privacy

WeChat Radar is designed as a local-first tool.

- Chat data is stored in a local SQLite database under `~/.wechat-radar` by default.
- The app does not upload chat records to a hosted service.
- The app reads data through your local `wx` CLI installation.
- Do not commit `*.db`, `.env.local`, logs, or generated runtime data.
- If you enable optional LLM/Codex workflows, review what data those tools receive before using them.

You are responsible for complying with local law, platform terms, and group member expectations before reading, storing, or processing chat data.
