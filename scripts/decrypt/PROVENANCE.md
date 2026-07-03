# PROVENANCE — vendored WeChat decrypt toolchain

This directory is **vendored** into wechat-radar (M7, 2026-07-03). The Python/C
sources are copied **verbatim** from the Hermes `wechat-assistant` decrypt
toolchain; only a provenance header comment was prepended to each file. Keeping
them unmodified means an upstream update is a clean re-copy, not a fork merge.

## Files and origin

| Vendored path | Upstream origin | Purpose |
|---|---|---|
| `decrypt/config.py` | wechat-assistant `scripts/decrypt/config.py` | YAML config loader |
| `decrypt/decrypt_db.py` | wechat-assistant `scripts/decrypt/decrypt_db.py` | Personal WeChat 4.x SQLCipher4 full decrypt |
| `decrypt/decrypt_wecom_db.py` | wechat-assistant `scripts/decrypt/decrypt_wecom_db.py` | Enterprise WeChat 5.x wxSQLite3 AES-128 decrypt |
| `decrypt/find_all_keys_macos.c` | wechat-assistant `scripts/decrypt/find_all_keys_macos.c` | Personal WeChat memory key scanner (macOS) |
| `decrypt/find_wecom_keys_macos.c` | wechat-assistant `scripts/decrypt/find_wecom_keys_macos.c` | Enterprise WeChat memory key scanner (macOS) |
| `refresh_decrypt.py` | wechat-assistant `scripts/refresh_decrypt.py` | WAL incremental refresh (~70ms/DB) |
| `wecom_collector.py` | wechat-assistant `scripts/wecom_collector.py` | Enterprise WeChat decrypt + collect into collector.db |

## Upstream credits (retained)

The `wechat-assistant` decrypt toolchain itself credits these third-party
kernels, and that attribution is carried forward here:

- **ylytdeng/wechat-decrypt** — personal WeChat SQLCipher4 + Enterprise WeChat
  wxSQLite3 AES-128 page-format decryption kernel.
- **bbingz/wechat-decrypt** — WAL incremental patch approach (cited in
  `refresh_decrypt.py`'s module docstring).

Original author copyright and in-file notices are preserved. No upstream
`LICENSE` file shipped with the source snapshot; downstream redistribution
should keep this attribution intact. If the upstream projects publish a license,
add it here.

## Re-syncing from upstream

1. Copy the files above from the current `wechat-assistant` checkout, preserving
   the `decrypt/` inner-directory layout.
2. Re-run the provenance-header step (the header block is the only local edit).
3. `scripts/decrypt/bootstrap.sh` to rebuild venv + scanners.
