# wechat-radar · vendored decrypt toolchain

Vendored Python/C that turns encrypted WeChat databases into plain SQLite that
radar can read. **radar itself contains no cryptography** — it only orchestrates
these scripts as subprocesses (`lib/decrypt.ts`) and consumes the decrypted
output. Sources are copied verbatim from Hermes `wechat-assistant`; see
[PROVENANCE.md](./PROVENANCE.md) for origin and third-party credits
(**ylytdeng/wechat-decrypt**, **bbingz/wechat-decrypt**).

## Layout

```
scripts/decrypt/
├── decrypt/
│   ├── config.py                  # YAML config loader
│   ├── decrypt_db.py              # personal WeChat SQLCipher4 decrypt
│   ├── decrypt_wecom_db.py        # Enterprise WeChat wxSQLite3 AES-128 decrypt
│   ├── find_all_keys_macos.c      # personal key scanner (source; compiled by bootstrap)
│   └── find_wecom_keys_macos.c    # Enterprise key scanner (source; compiled by bootstrap)
├── refresh_decrypt.py             # WAL incremental refresh (~70ms/DB)
├── wecom_collector.py             # Enterprise decrypt + collect into collector.db
├── requirements.txt               # pycryptodome, zstandard, pyyaml
├── bootstrap.sh                   # venv + deps + compile scanners
├── PROVENANCE.md / README.md
```

## Setup

```bash
scripts/decrypt/bootstrap.sh          # creates .venv, installs deps, compiles scanners
```

## The two-step model (permissions)

Key extraction and decryption are **deliberately split** so radar never runs
`sudo` for you.

### Step 1 — key extraction (you run this, once / when keys expire)

Reading another process's memory needs **root + WeChat ad-hoc signed** (or SIP
off). radar **generates and shows you the exact command** but never runs it:

```bash
# personal WeChat (WeChat must be running):
sudo scripts/decrypt/decrypt/find_all_keys_macos            # -> all_keys.json
# Enterprise WeChat (企业微信 must be running):
sudo scripts/decrypt/decrypt/find_wecom_keys_macos <pid> <profile_dir> wecom_keys.json
```

The key JSON files hold **plaintext AES keys** and are gitignored — never commit
them.

### Step 2 — decrypt + refresh + collect (radar orchestrates, no root)

Needs only read access to the WeChat container (grant the running terminal /
node process **Full Disk Access**), not root:

```bash
# personal WeChat: full first time, then WAL-incremental (~70ms/DB)
scripts/decrypt/.venv/bin/python scripts/decrypt/refresh_decrypt.py --config config.yaml
# Enterprise WeChat: decrypt latest Messages1 + sync into collector.db
scripts/decrypt/.venv/bin/python scripts/decrypt/wecom_collector.py --sync --config config.yaml
```

radar drives Step 2 from `rescan` / `/api/decrypt`. If `refresh_decrypt.py`
exits **code 2**, keys are stale (WeChat restarted) — re-run Step 1.

## Never commit

`*_keys.json`, `all_keys.json`, decrypted `*.db`, `.venv/`, compiled scanners,
and any generated `config*.yaml` (may embed paths/PII). Enforced in
`.gitignore`.
