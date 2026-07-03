# Frida hook fallback — key extraction

Fallback for when static memory-pattern scanning (`find_all_keys_macos` /
`find_wecom_keys_macos`) stops finding keys after a WeChat / WXWork version bump
changes the in-memory layout. Hooking the crypto **API contract** is far more
stable across versions than scanning byte patterns.

**radar never runs these** — per plan A, radar only *generates* the command for
you to run in a terminal. This directory is new code (not vendored); it reuses
the same key-extraction ideas as the memory scanners.

## Files

| File | Role |
|---|---|
| `wechat-key-hook.js` | Frida hook. S1: `sqlite3_key`/`sqlite3_key_v2` (WXWork + old personal). S2: `CCKeyDerivationPBKDF` (new personal). Emits keys via `send()`. |
| `frida_extract.py` | Driver. Attaches/spawns the target, collects keys, writes keys JSON in the **same format** as `find_all_keys` (downstream unchanged). |
| `match_keys.py` | Resolves db-less `_candidate_keys` (from the PBKDF path) to specific DBs by page-1 HMAC. Stdlib only; does not touch vendored code. |
| `requirements-frida.txt` | Optional heavy deps (`frida`, `frida-tools`). |

## Install (optional)

```bash
scripts/decrypt/bootstrap.sh --with-frida
# or
scripts/decrypt/.venv/bin/pip install -r scripts/decrypt/frida/requirements-frida.txt
```

## Use (you run this; radar only shows the command)

```bash
# personal WeChat (WeChat must be running):
sudo scripts/decrypt/.venv/bin/python scripts/decrypt/frida/frida_extract.py \
     --target personal --out all_keys.json
# then resolve PBKDF candidate keys to DBs:
scripts/decrypt/.venv/bin/python scripts/decrypt/frida/match_keys.py \
     --keys-file all_keys.json --db-dir <db_storage dir>

# WXWork / 企业微信:
sudo scripts/decrypt/.venv/bin/python scripts/decrypt/frida/frida_extract.py \
     --target wecom --out wecom_keys.json
```

- **`--spawn <bundle>`** launches the app under Frida to capture *every* DB open
  from process start (complete, but restarts the app). Default **attach** is
  non-invasive but only sees DBs opened after attach — open a chat / switch
  account to trigger fresh opens.

## macOS prerequisites (same class as the C scanners)

Frida attach needs **root + a debuggable target**. One of:
1. ad-hoc re-sign the app with `get-task-allow` entitlement
   (`codesign -s - --entitlements ent.plist -f <app>`), or
2. disable SIP (`csrutil disable`, recovery mode), or
3. an already ad-hoc-signed app run under `sudo`.

If none is possible, Frida attach will fail with permission-denied — see the
driver's error messages.

## Never commit

`all_keys.json` / `wecom_keys.json` / `*_candidate*` / decrypted `*.db` / `.venv`
— all gitignored.

## Lineage

Memory-scan sibling: **ylytdeng/wechat-decrypt** `find_wxwork_keys.py`
(Windows-only). WXWork `sqlite3_key` hook approach: **看雪 (kanxue)
thread-289242**.
