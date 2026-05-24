# Security

## Reporting

Please open a GitHub security advisory or a private issue if you find a vulnerability.

## Local data

The most sensitive asset is your local SQLite database. Keep it outside synced folders and do not publish it. The default path is `~/.wechat-radar/radar.db`.

## Command execution

The app invokes `wx` via `child_process.execFile` with argument arrays. Avoid changing this to shell string execution.
