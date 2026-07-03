#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# VENDORED — DO NOT EDIT LOGIC. Verbatim copy for clean upstream re-sync.
# Source: Hermes `wechat-assistant` decrypt toolchain (scripts/ + scripts/decrypt/).
# Upstream kernels credited by that toolchain:
#   - ylytdeng/wechat-decrypt  (个人微信 SQLCipher4 + 企业微信 wxSQLite3 内核)
#   - bbingz/wechat-decrypt    (WAL 增量 patch 思路, see refresh_decrypt.py)
# Vendored into wechat-radar 2026-07-03 (M7). See scripts/decrypt/PROVENANCE.md.
# Original author copyright/notices retained. Only this header block was added.
# ─────────────────────────────────────────────────────────────────────────────
"""
Enterprise WeChat macOS database decryptor.

The key format consumed by this script is the JSON written by
find_wecom_keys_macos. Enterprise WeChat 5.x uses a wxSQLite3-style
AES-128-CBC page codec, not the SQLCipher format used by personal WeChat.
"""
import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import struct
import sys
import time

try:
    from Crypto.Cipher import AES
except ImportError:
    print("[ERROR] missing pycryptodome, run: pip3 install pycryptodome", file=sys.stderr)
    sys.exit(1)

PAGE_SZ = 4096
SQLITE_HDR = b"SQLite format 3\x00"
WAL_HEADER_SZ = 32
WAL_FRAME_HEADER_SZ = 24

DEFAULT_PREFIXES = (
    "Messages1/",
    "Contact/",
    "WechatMessage/",
    "CustomerMessage/",
)


def normalize_rel_path(path):
    return path.replace("\\", "/").strip("/")


def is_plain_sqlite_page(page):
    return page.startswith(SQLITE_HDR)


def has_wxsqlite3_header_fragment(page):
    if len(page) < 24:
        return False
    page_size = (page[16] << 8) | page[17]
    if page_size == 1:
        page_size = 65536
    return (
        512 <= page_size <= 65536
        and page_size & (page_size - 1) == 0
        and page[21] == 0x40
        and page[22] == 0x20
        and page[23] == 0x20
    )


def modmult(a, b, c, m, s):
    q = s // a
    next_value = b * (s - a * q) - c * q
    if next_value < 0:
        next_value += m
    return next_value & 0xFFFFFFFF


def generate_initial_vector(page_no):
    z = page_no + 1
    init_key = bytearray()
    for _ in range(4):
        z = modmult(52774, 40692, 3791, 2147483399, z)
        init_key += struct.pack("<I", z)
    return hashlib.md5(init_key).digest()


def derive_page_key(raw_key, page_no):
    return hashlib.md5(raw_key + struct.pack("<I", page_no) + b"sAlT").digest()


def decrypt_page(raw_key, page_data, page_no):
    if len(page_data) < PAGE_SZ:
        page_data = page_data + b"\x00" * (PAGE_SZ - len(page_data))
    elif len(page_data) > PAGE_SZ:
        page_data = page_data[:PAGE_SZ]

    if page_no == 1 and is_plain_sqlite_page(page_data):
        return page_data

    page_key = derive_page_key(raw_key, page_no)
    iv = generate_initial_vector(page_no)

    if page_no == 1:
        work = bytearray(page_data)
        header_fragment = bytes(work[16:24])
        work[16:24] = work[8:16]
        tail = AES.new(page_key, AES.MODE_CBC, iv).decrypt(bytes(work[16:]))
        out = SQLITE_HDR + tail
        if out[16:24] != header_fragment:
            raise ValueError("page 1 header fragment check failed")
        return out

    return AES.new(page_key, AES.MODE_CBC, iv).decrypt(page_data)


def looks_like_sqlite_page1(page):
    if not page.startswith(SQLITE_HDR) or len(page) <= 100:
        return False
    return page[100] in (0x02, 0x05, 0x0A, 0x0D)


def verify_key(db_path, raw_key):
    with open(db_path, "rb") as fh:
        page1 = fh.read(PAGE_SZ)
    if len(page1) < PAGE_SZ:
        return False
    if is_plain_sqlite_page(page1):
        return True
    if not has_wxsqlite3_header_fragment(page1):
        return False
    try:
        return looks_like_sqlite_page1(decrypt_page(raw_key, page1, 1))
    except Exception:
        return False


def decrypt_database(db_path, out_path, raw_key):
    with open(db_path, "rb") as fh:
        first_page = fh.read(PAGE_SZ)
    if is_plain_sqlite_page(first_page):
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        shutil.copy2(db_path, out_path)
        return 0

    file_size = os.path.getsize(db_path)
    total_pages = file_size // PAGE_SZ
    if file_size % PAGE_SZ:
        total_pages += 1

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(db_path, "rb") as fin, open(out_path, "wb") as fout:
        for page_no in range(1, total_pages + 1):
            page = fin.read(PAGE_SZ)
            if not page:
                break
            fout.write(decrypt_page(raw_key, page, page_no))
    return total_pages


def patch_wal(wal_path, out_path, raw_key):
    if not os.path.exists(wal_path) or not os.path.exists(out_path):
        return 0
    if os.path.getsize(wal_path) <= WAL_HEADER_SZ:
        return 0

    patched = 0
    frame_size = WAL_FRAME_HEADER_SZ + PAGE_SZ
    with open(wal_path, "rb") as wf, open(out_path, "r+b") as df:
        wal_header = wf.read(WAL_HEADER_SZ)
        if len(wal_header) < WAL_HEADER_SZ:
            return 0
        salt1 = struct.unpack(">I", wal_header[16:20])[0]
        salt2 = struct.unpack(">I", wal_header[20:24])[0]

        while wf.tell() + frame_size <= os.path.getsize(wal_path):
            frame_header = wf.read(WAL_FRAME_HEADER_SZ)
            if len(frame_header) < WAL_FRAME_HEADER_SZ:
                break
            page_no = struct.unpack(">I", frame_header[0:4])[0]
            frame_salt1 = struct.unpack(">I", frame_header[8:12])[0]
            frame_salt2 = struct.unpack(">I", frame_header[12:16])[0]
            encrypted_page = wf.read(PAGE_SZ)
            if len(encrypted_page) < PAGE_SZ:
                break
            if page_no <= 0 or page_no > 10000000:
                continue
            if frame_salt1 != salt1 or frame_salt2 != salt2:
                continue

            df.seek((page_no - 1) * PAGE_SZ)
            df.write(decrypt_page(raw_key, encrypted_page, page_no))
            patched += 1
    return patched


def validate_sqlite(path):
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
            ).fetchone()
            return int(row[0] or 0), None
    except Exception as exc:
        return 0, str(exc)


def load_keys(keys_file):
    with open(keys_file) as fh:
        raw = json.load(fh)
    keys = {}
    for rel, info in raw.items():
        if rel.startswith("_"):
            continue
        key_hex = (info or {}).get("enc_key", "")
        key = bytes.fromhex(key_hex)
        if len(key) != 16:
            raise ValueError(f"{rel}: expected 16-byte WeCom key, got {len(key)} bytes")
        keys[normalize_rel_path(rel)] = key
    return keys


def iter_db_files(db_dir, keys, prefixes, decrypt_all=False):
    for root, _, files in os.walk(db_dir):
        for fn in files:
            if not fn.endswith(".db"):
                continue
            src_path = os.path.join(root, fn)
            rel = normalize_rel_path(os.path.relpath(src_path, db_dir))
            if rel not in keys:
                continue
            if not decrypt_all and not any(rel.startswith(prefix) for prefix in prefixes):
                continue
            yield rel, src_path


def load_config(config_path):
    script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.join(script_dir, "decrypt"))
    from config import load_config as _load

    return _load(config_path)


def parse_args():
    parser = argparse.ArgumentParser(description="Decrypt Enterprise WeChat databases")
    parser.add_argument("--config", help="wechat-assistant config.yaml")
    parser.add_argument("--db-dir", help="Enterprise WeChat profile directory")
    parser.add_argument("--keys-file", help="find_wecom_keys_macos JSON output")
    parser.add_argument("--out-dir", help="directory for decrypted databases")
    parser.add_argument("--prefix", action="append", help="relative DB prefix to decrypt")
    parser.add_argument("--all", action="store_true", help="decrypt every keyed DB")
    parser.add_argument("--no-wal", action="store_true", help="do not patch .db-wal frames")
    parser.add_argument("--verify-only", action="store_true", help="only verify keys")
    return parser.parse_args()


def main():
    args = parse_args()
    cfg = load_config(args.config) if args.config else {}

    db_dir = args.db_dir or cfg.get("db_dir", "")
    keys_file = args.keys_file or cfg.get("keys_file", "")
    out_dir = args.out_dir or cfg.get("decrypted_dir", "")
    prefixes = tuple(normalize_rel_path(p) + "/" for p in (args.prefix or ()))
    if not prefixes:
        prefixes = DEFAULT_PREFIXES

    if not db_dir or not os.path.isdir(db_dir):
        print("[ERROR] missing Enterprise WeChat profile directory", file=sys.stderr)
        return 1
    if not keys_file or not os.path.exists(keys_file):
        print("[ERROR] missing wecom_keys.json", file=sys.stderr)
        return 1
    if not args.verify_only and not out_dir:
        print("[ERROR] missing output directory", file=sys.stderr)
        return 1

    keys = load_keys(keys_file)
    db_files = list(iter_db_files(db_dir, keys, prefixes, args.all))
    if not db_files:
        print("[WARN] no keyed Enterprise WeChat DBs matched")
        return 0

    started = time.perf_counter()
    ok_count = 0
    fail_count = 0
    wal_pages = 0
    total_pages = 0

    for rel, src_path in db_files:
        raw_key = keys[rel]
        if not verify_key(src_path, raw_key):
            print(f"[ERROR] key verification failed: {rel}", file=sys.stderr)
            fail_count += 1
            continue
        if args.verify_only:
            print(f"VERIFY OK: {rel}")
            ok_count += 1
            continue

        out_path = os.path.join(out_dir, rel)
        try:
            pages = decrypt_database(src_path, out_path, raw_key)
            total_pages += pages
            patched = 0 if args.no_wal else patch_wal(src_path + "-wal", out_path, raw_key)
            wal_pages += patched
            table_count, err = validate_sqlite(out_path)
            if err:
                print(f"[WARN] decrypted but sqlite validation failed: {rel}: {err}")
            else:
                print(f"OK: {rel} ({pages} pages, wal {patched}, tables {table_count})")
            ok_count += 1
        except Exception as exc:
            print(f"[ERROR] decrypt failed: {rel}: {exc}", file=sys.stderr)
            fail_count += 1

    elapsed_ms = (time.perf_counter() - started) * 1000
    action = "verified" if args.verify_only else "decrypted"
    print(
        f"[wecom-decrypt] {action}: {ok_count} ok, {fail_count} failed, "
        f"{total_pages} pages, {wal_pages} wal pages, {elapsed_ms:.0f}ms"
    )
    return 1 if fail_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
