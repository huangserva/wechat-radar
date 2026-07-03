#!/usr/bin/env python3
"""
match_keys.py — resolve db-less candidate keys to specific DBs by page-1 HMAC.

The CCKeyDerivationPBKDF hook (frida_extract.py) captures raw personal-WeChat
keys without a DB association (no sqlite handle at that call site). This script
validates each `_candidate_keys` entry against every SQLCipher4 DB in --db-dir
using the same page-1 HMAC check the decrypter uses, and promotes matches to
real `{ "rel/path.db": {"enc_key": hex} }` entries in the keys JSON.

Standalone by design — it does NOT edit the vendored decrypt scripts. The HMAC
validation is re-implemented here from stdlib only (hashlib/hmac/struct), no
pycryptodome, since verifying a key needs no AES.

SQLCipher4 params (personal WeChat 4.x): page 4096, reserve 80 (IV16+HMAC64),
salt = first 16 bytes of the file, HMAC-SHA512, mac_key = PBKDF2-HMAC-SHA512(
enc_key, salt XOR 0x3a, 2 rounds, 32 bytes).
"""
import argparse
import hashlib
import hmac as hmac_mod
import json
import os
import struct
import sys

PAGE_SZ = 4096
SALT_SZ = 16
IV_SZ = 16
HMAC_SZ = 64
RESERVE_SZ = 80
SQLITE_HDR = b"SQLite format 3\x00"
KEY_SZ = 32
NEEDED_PREFIXES = ("message/", "contact/", "session/")


def derive_mac_key(enc_key, salt):
    mac_salt = bytes(b ^ 0x3A for b in salt)
    return hashlib.pbkdf2_hmac("sha512", enc_key, mac_salt, 2, dklen=KEY_SZ)


def page1_hmac_ok(page1, enc_key):
    if len(page1) < PAGE_SZ:
        return False
    if page1[:len(SQLITE_HDR)] == SQLITE_HDR:
        return False  # already plaintext, not encrypted with this scheme
    salt = page1[:SALT_SZ]
    try:
        mac_key = derive_mac_key(enc_key, salt)
    except Exception:
        return False
    hmac_data = page1[SALT_SZ:PAGE_SZ - RESERVE_SZ + IV_SZ]
    stored = page1[PAGE_SZ - HMAC_SZ:PAGE_SZ]
    hm = hmac_mod.new(mac_key, hmac_data, hashlib.sha512)
    hm.update(struct.pack("<I", 1))
    return hmac_mod.compare_digest(hm.digest(), stored)


def normalize_rel(path):
    return path.replace("\\", "/").strip("/")


def iter_dbs(db_dir):
    for root, _dirs, files in os.walk(db_dir):
        for fn in files:
            if fn.endswith(".db") and not fn.endswith("-wal") and not fn.endswith("-shm"):
                p = os.path.join(root, fn)
                rel = normalize_rel(os.path.relpath(p, db_dir))
                if any(rel.startswith(pre) for pre in NEEDED_PREFIXES) or True:
                    yield rel, p


def main(argv=None):
    parser = argparse.ArgumentParser(description="Match db-less candidate keys to DBs by HMAC")
    parser.add_argument("--keys-file", required=True, help="keys JSON with _candidate_keys")
    parser.add_argument("--db-dir", required=True, help="encrypted DB root")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    if not os.path.exists(args.keys_file):
        print(f"[ERROR] keys file missing: {args.keys_file}", file=sys.stderr)
        return 3
    with open(args.keys_file, encoding="utf-8") as f:
        keys = json.load(f)

    candidates = keys.get("_candidate_keys") or []
    if not candidates:
        print("[match] no _candidate_keys to resolve", file=sys.stderr)
        return 0
    if not os.path.isdir(args.db_dir):
        print(f"[ERROR] db-dir not a directory: {args.db_dir}", file=sys.stderr)
        return 3

    # unique candidate key bytes
    cand_bytes = []
    seen = set()
    for c in candidates:
        h = (c.get("key_hex") or "").strip()
        if not h or h in seen:
            continue
        seen.add(h)
        try:
            cand_bytes.append((h, bytes.fromhex(h)))
        except ValueError:
            continue

    matched = 0
    for rel, path in iter_dbs(args.db_dir):
        if rel in keys and isinstance(keys[rel], dict) and keys[rel].get("enc_key"):
            continue  # already resolved
        try:
            with open(path, "rb") as fh:
                page1 = fh.read(PAGE_SZ)
        except OSError:
            continue
        for h, kb in cand_bytes:
            if len(kb) != KEY_SZ:
                continue
            if page1_hmac_ok(page1, kb):
                keys[rel] = {"enc_key": h}
                matched += 1
                if args.verbose:
                    print(f"[match] {rel} <- candidate {h[:8]}…", file=sys.stderr)
                break

    tmp = args.keys_file + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(keys, f, ensure_ascii=False, indent=2)
    os.replace(tmp, args.keys_file)
    print(f"[match] resolved {matched} DB(s) from {len(cand_bytes)} candidate key(s)", file=sys.stderr)
    return 0 if matched else 1


if __name__ == "__main__":
    sys.exit(main())
