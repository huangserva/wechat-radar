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
Collect decrypted Enterprise WeChat messages into collector.db.

Expected decrypted schema, observed from the Enterprise WeChat 5.x binary:
  MESSAGE(LID, RID, message_type, conv_id, seq, sender_id, content_type,
          send_time, url, content, isread, flag, extras, devinfo, refer,
          extracontent, fw_id)
  CONVERSATION(LID, RID, name, ..., conversationtype, ..., fw_id, ...)
  USER(RID, name, ...)
"""
import argparse
import csv
import json
import os
import re
import sqlite3
import subprocess
import sys

try:
    import zstandard as zstd
    _ZSTD = zstd.ZstdDecompressor()
except ImportError:
    _ZSTD = None

MESSAGE_COLUMNS = [
    "LID",
    "RID",
    "message_type",
    "conv_id",
    "seq",
    "sender_id",
    "content_type",
    "send_time",
    "url",
    "content",
    "isread",
    "flag",
    "extras",
    "devinfo",
    "refer",
    "extracontent",
    "fw_id",
]

PRINTABLE_RE = re.compile(r"[^\x00-\x08\x0b\x0c\x0e-\x1f]+")
LEGACY_PROTO_TEXT_RE = re.compile(r"\s+[A-Za-z](?:\s+[A-Za-z])+\s+")


def normalize_rel_path(path):
    return path.replace("\\", "/").strip("/")


def load_config(config_path):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(script_dir, "decrypt"))
    from config import load_config as _load

    return _load(config_path)


def pick_collector_db(args_path="", config_path=""):
    if args_path:
        return args_path
    if config_path:
        return config_path
    for candidate in ("./collector-wecom-query.db", "./collector-wecom-full.db", "./collector.db"):
        if os.path.exists(candidate):
            return candidate
    return "./collector-wecom-query.db"


def pick_decrypted_dir(args_path="", config_path=""):
    if args_path:
        return args_path
    if config_path:
        return config_path
    for candidate in ("./wecom-decrypted", "./decrypted"):
        if os.path.isdir(candidate):
            return candidate
    return "./wecom-decrypted"


def pick_keys_file(config_path=""):
    if config_path:
        return config_path
    for candidate in ("./wecom_keys.json", "./all_keys.json"):
        if os.path.exists(candidate):
            return candidate
    return ""


def discover_wecom_profile_dir():
    base = os.path.expanduser("~/Library/Containers/com.tencent.WeWorkMac/Data/Documents/Profiles")
    if not os.path.isdir(base):
        return ""
    candidates = []
    for name in os.listdir(base):
        profile = os.path.join(base, name)
        info_db = os.path.join(profile, "Messages1", "Info.db")
        if os.path.exists(info_db):
            try:
                mtime = os.path.getmtime(info_db)
            except OSError:
                mtime = 0
            candidates.append((mtime, profile))
    if not candidates:
        return ""
    candidates.sort(reverse=True)
    return candidates[0][1]


def pick_wecom_db_dir(config_path=""):
    if config_path:
        return config_path
    return discover_wecom_profile_dir()


def decode_value(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        data = bytes(value)
        if not data:
            return ""
        if _ZSTD:
            try:
                return clean_text(_ZSTD.decompress(data, max_output_size=1024 * 1024).decode("utf-8", "replace"))
            except Exception:
                pass
        proto_text = decode_proto_text(data)
        if proto_text:
            return proto_text
        utf8_text = extract_payload_text(data.decode("utf-8", "ignore"))
        if payload_text_score(utf8_text) >= 0.25:
            return utf8_text
        for encoding in ("utf-8", "utf-16le"):
            try:
                text = extract_payload_text(data.decode(encoding))
                if text_score(text) >= 0.65 and payload_text_score(text) >= 0.25:
                    return clean_text(text)
            except Exception:
                pass
        text = data.decode("utf-8", "ignore")
        pieces = [p.strip() for p in PRINTABLE_RE.findall(text) if len(p.strip()) >= 2]
        return clean_text(" ".join(pieces[:8]))
    return clean_text(str(value))


def read_varint(data, offset):
    value = 0
    shift = 0
    while offset < len(data) and shift < 70:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
    raise ValueError("invalid varint")


def has_control_chars(text):
    return any(ord(ch) < 32 and ch not in "\r\n\t" for ch in text)


def proto_text_parts(data, depth=0):
    if depth > 5 or not data:
        return []

    parts = []
    offset = 0
    while offset < len(data):
        try:
            tag, offset = read_varint(data, offset)
        except ValueError:
            break

        field_no = tag >> 3
        wire_type = tag & 7
        if field_no <= 0:
            break

        try:
            if wire_type == 0:
                _, offset = read_varint(data, offset)
            elif wire_type == 1:
                offset += 8
            elif wire_type == 5:
                offset += 4
            elif wire_type == 2:
                size, offset = read_varint(data, offset)
                payload = data[offset : offset + size]
                offset += size
                child_parts = proto_text_parts(payload, depth + 1)
                if child_parts:
                    parts.extend(child_parts)
                    continue
                try:
                    text = payload.decode("utf-8")
                except UnicodeDecodeError:
                    continue
                if has_control_chars(text):
                    continue
                if payload_text_score(text) >= 0.55 and any(
                    "\u4e00" <= ch <= "\u9fff" or ch.isalnum() for ch in text
                ):
                    parts.append(text)
            else:
                break
        except Exception:
            break
    return parts


def looks_like_mention_name(text):
    text = clean_text(text)
    if not text or len(text) > 64:
        return False
    if any(mark in text for mark in ("，", "。", ",", ":", "：", "；", ";", "？", "?", "！", "!")):
        return False
    return any("\u4e00" <= ch <= "\u9fff" or ch.isalpha() for ch in text)


def decode_proto_text(data):
    parts = [clean_text(part) for part in proto_text_parts(data)]
    parts = [part for part in parts if part]
    if not parts:
        return ""

    if len(parts) >= 2:
        body = parts[-1]
        mentions = [part for part in parts[:-1] if looks_like_mention_name(part)]
        if mentions and len(body) >= 2:
            return clean_text(" ".join(f"@{name}" for name in mentions) + " " + body)

    # Prefer the longest string; wrapper fields can decode to short tag-looking
    # fragments while the nested field contains the actual user-visible text.
    return clean_text(max(parts, key=len))


def payload_text_score(text):
    text = clean_text(text)
    if not text:
        return 0.0
    good = 0
    bad = 0
    for ch in text[:1000]:
        code = ord(ch)
        if (
            "\u4e00" <= ch <= "\u9fff"
            or "\u3000" <= ch <= "\u303f"
            or "\uff00" <= ch <= "\uffef"
            or ch.isascii() and (ch.isalnum() or ch.isspace() or ch in ":：,，.。;；()（）-_/@#[]{}<>=\"'`+%!?！？")
        ):
            good += 1
        elif "\ue000" <= ch <= "\uf8ff":
            bad += 2
        else:
            bad += 1
    return good / max(good + bad, 1)


def is_payload_char(ch):
    code = ord(ch)
    return (
        "\u4e00" <= ch <= "\u9fff"
        or "\u3000" <= ch <= "\u303f"
        or "\uff00" <= ch <= "\uffef"
        or ch.isascii() and (ch.isalnum() or ch.isspace() or ch in ":：,，.。;；()（）-_/@#[]{}<>=\"'`+%!?！？")
    )


def extract_payload_text(text):
    parts = []
    current = []
    for ch in text:
        if is_payload_char(ch):
            current.append(ch)
        else:
            if current:
                parts.append("".join(current))
                current = []
    if current:
        parts.append("".join(current))

    useful = []
    for part in parts:
        part = clean_text(part)
        part = re.sub(r"^[^\w\u4e00-\u9fff]+", "", part)
        if not part:
            continue
        has_payload = any("\u4e00" <= ch <= "\u9fff" or ch.isalnum() for ch in part)
        if has_payload and payload_text_score(part) >= 0.5:
            useful.append(part)
    return clean_text(" ".join(useful))


def text_score(text):
    if not text:
        return 0.0
    sample = text[:500]
    good = 0
    for ch in sample:
        code = ord(ch)
        if ch in "\n\r\t" or code >= 32:
            good += 1
    return good / max(len(sample), 1)


def clean_text(text):
    text = text.replace("\x00", "")
    text = "".join(ch if ch in "\n\r\t" or ord(ch) >= 32 else " " for ch in text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_ts(value):
    try:
        ts = int(value or 0)
    except (TypeError, ValueError):
        return 0
    if ts > 10_000_000_000:
        ts = ts // 1000
    return ts


def connect_ro(path):
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.text_factory = lambda b: b.decode("utf-8", errors="replace")
    return conn


def table_exists(conn, name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND upper(name)=upper(?)",
        (name,),
    ).fetchone() is not None


def table_columns(conn, table):
    try:
        return [row[1] for row in conn.execute(f"PRAGMA table_info([{table}])")]
    except sqlite3.Error:
        return []


def colmap(cols):
    return {col.lower(): col for col in cols}


def pick(cols, *names):
    lookup = colmap(cols)
    for name in names:
        got = lookup.get(name.lower())
        if got:
            return got
    return None


def iter_sqlite_dbs(decrypted_dir):
    roots = [
        os.path.join(decrypted_dir, "Messages1"),
        os.path.join(decrypted_dir, "Contact"),
        os.path.join(decrypted_dir, "WechatMessage"),
        os.path.join(decrypted_dir, "CustomerMessage"),
    ]
    seen = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            for fn in files:
                if not fn.endswith(".db"):
                    continue
                path = os.path.join(dirpath, fn)
                if path in seen:
                    continue
                seen.add(path)
                try:
                    with open(path, "rb") as fh:
                        if not fh.read(16).startswith(b"SQLite format 3\x00"):
                            continue
                except OSError:
                    continue
                yield path


def rel_to(decrypted_dir, path):
    return normalize_rel_path(os.path.relpath(path, decrypted_dir))


def load_names(decrypted_dir):
    names = {}
    for path in iter_sqlite_dbs(decrypted_dir):
        try:
            with connect_ro(path) as conn:
                if not table_exists(conn, "USER"):
                    continue
                cols = table_columns(conn, "USER")
                rid_col = pick(cols, "RID", "rid")
                name_col = pick(cols, "name", "nick_name", "remark", "alias")
                alias_col = pick(cols, "alias", "fullpath")
                if not rid_col:
                    continue
                select_cols = [f"[{rid_col}]"]
                select_cols.append(f"[{name_col}]" if name_col else "NULL")
                select_cols.append(f"[{alias_col}]" if alias_col else "NULL")
                for rid, name, alias in conn.execute(
                    f"SELECT {', '.join(select_cols)} FROM USER"
                ):
                    display = decode_value(name) or decode_value(alias) or str(rid)
                    names[str(rid)] = display
        except sqlite3.Error:
            continue
    return names


def load_conversations(decrypted_dir):
    conversations = {}
    for path in iter_sqlite_dbs(decrypted_dir):
        try:
            with connect_ro(path) as conn:
                if not table_exists(conn, "CONVERSATION"):
                    continue
                cols = table_columns(conn, "CONVERSATION")
                rid_col = pick(cols, "RID", "rid")
                type_col = pick(cols, "conversationtype", "message_type")
                fw_col = pick(cols, "fw_id", "FW_ID")
                name_col = pick(cols, "name", "last_message_content")
                if not rid_col or not type_col:
                    continue
                query = (
                    f"SELECT [{rid_col}], [{type_col}], "
                    f"{f'[{fw_col}]' if fw_col else '0'}, "
                    f"{f'[{name_col}]' if name_col else 'NULL'} "
                    "FROM CONVERSATION"
                )
                for rid, conversation_type, fw_id, name in conn.execute(query):
                    key = (str(rid), str(conversation_type or 0), str(fw_id or 0))
                    conversations[key] = decode_value(name) or f"wecom:{key[1]}:{key[0]}:{key[2]}"
        except sqlite3.Error:
            continue
    return conversations


def init_collector_db(collector_db):
    with sqlite3.connect(collector_db, timeout=30) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                chatroom_id TEXT NOT NULL,
                sender      TEXT,
                content     TEXT,
                msg_time    INTEGER,
                local_id    TEXT,
                msg_type    INTEGER DEFAULT 1,
                UNIQUE(chatroom_id, local_id)
            );
            CREATE INDEX IF NOT EXISTS idx_chat_time ON messages(chatroom_id, msg_time DESC);
            CREATE INDEX IF NOT EXISTS idx_chat_local ON messages(chatroom_id, local_id);
            CREATE TABLE IF NOT EXISTS watched_chats (
                chatroom_id   TEXT PRIMARY KEY,
                chatroom_name TEXT,
                added_at      INTEGER DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_watched_name ON watched_chats(chatroom_name);
            CREATE TABLE IF NOT EXISTS sync_state (
                chatroom_id   TEXT PRIMARY KEY,
                last_local_id TEXT DEFAULT '0',
                last_sync_at  INTEGER DEFAULT 0
            );
            """
        )


def conversation_chat_id(key):
    rid, conversation_type, fw_id = key
    return f"wecom:{conversation_type}:{rid}:{fw_id}"


def is_placeholder_chat_name(name):
    return not name or str(name).startswith("wecom:")


def upsert_watched_chat(conn, chatroom_id, chatroom_name):
    if not chatroom_name:
        return
    if is_placeholder_chat_name(chatroom_name):
        conn.execute(
            "INSERT OR IGNORE INTO watched_chats(chatroom_id, chatroom_name) VALUES(?, ?)",
            (chatroom_id, chatroom_name),
        )
        return
    conn.execute(
        """
        INSERT INTO watched_chats(chatroom_id, chatroom_name) VALUES(?, ?)
        ON CONFLICT(chatroom_id) DO UPDATE SET chatroom_name=excluded.chatroom_name
        WHERE watched_chats.chatroom_name IS NULL
           OR watched_chats.chatroom_name = ''
           OR watched_chats.chatroom_name LIKE 'wecom:%'
           OR watched_chats.chatroom_name != excluded.chatroom_name
        """,
        (chatroom_id, chatroom_name),
    )


def refresh_watched_chat_names(conn, conversations):
    for key, name in conversations.items():
        if is_placeholder_chat_name(name):
            continue
        upsert_watched_chat(conn, conversation_chat_id(key), name)


def refresh_self_sender_names(conn, names, self_vid=""):
    if not self_vid:
        return
    display_name = sender_name(str(self_vid), names, self_vid=self_vid)
    if display_name and display_name != "__self__":
        conn.execute("UPDATE messages SET sender=? WHERE sender='__self__'", (display_name,))


def repair_legacy_proto_texts(decrypted_dir, conn):
    try:
        rows = conn.execute(
            "SELECT id, local_id FROM messages WHERE content LIKE '% x t r %' OR content LIKE '%\\nr %'"
        ).fetchall()
    except sqlite3.Error:
        return 0

    lids_by_rel = {}
    for row_id, local_id in rows:
        if not local_id or ":" not in str(local_id):
            continue
        rel, lid = str(local_id).rsplit(":", 1)
        if not lid.isdigit():
            continue
        lids_by_rel.setdefault(rel, []).append((int(row_id), lid))

    repaired = 0
    for rel, items in lids_by_rel.items():
        path = os.path.join(decrypted_dir, rel)
        if not os.path.exists(path):
            continue
        lids = [lid for _, lid in items]
        row_ids = {lid: row_id for row_id, lid in items}
        try:
            with connect_ro(path) as msg_conn:
                placeholders = ",".join("?" for _ in lids)
                sql = (
                    f"SELECT {', '.join(f'[{name}]' for name in MESSAGE_COLUMNS)} "
                    f"FROM MESSAGE WHERE LID IN ({placeholders})"
                )
                for values in msg_conn.execute(sql, lids):
                    row = dict(zip(MESSAGE_COLUMNS, values))
                    lid = str(row.get("LID") or "")
                    row_id = row_ids.get(lid)
                    if not row_id:
                        continue
                    content = message_content(row)[:4000]
                    if content:
                        conn.execute("UPDATE messages SET content=? WHERE id=?", (content, row_id))
                        repaired += 1
        except sqlite3.Error:
            continue
    return repaired


def infer_self_vid_from_legacy_rows(decrypted_dir, conn, sample_size=500):
    try:
        legacy_rows = conn.execute(
            "SELECT local_id FROM messages WHERE sender='__self__' LIMIT ?",
            (int(sample_size),),
        ).fetchall()
    except sqlite3.Error:
        return ""

    lids_by_rel = {}
    for (local_id,) in legacy_rows:
        if not local_id or ":" not in str(local_id):
            continue
        rel, lid = str(local_id).rsplit(":", 1)
        if not lid.isdigit():
            continue
        lids_by_rel.setdefault(rel, []).append(lid)

    counts = {}
    for rel, lids in lids_by_rel.items():
        path = os.path.join(decrypted_dir, rel)
        if not os.path.exists(path):
            continue
        try:
            with connect_ro(path) as msg_conn:
                placeholders = ",".join("?" for _ in lids)
                sql = f"SELECT sender_id, COUNT(*) FROM MESSAGE WHERE LID IN ({placeholders}) GROUP BY sender_id"
                for sender_id, count in msg_conn.execute(sql, lids):
                    key = str(sender_id or "")
                    if key:
                        counts[key] = counts.get(key, 0) + int(count or 0)
        except sqlite3.Error:
            continue

    if not counts:
        return ""
    return max(counts.items(), key=lambda item: item[1])[0]


def find_message_dbs(decrypted_dir):
    out = []
    for path in iter_sqlite_dbs(decrypted_dir):
        try:
            with connect_ro(path) as conn:
                if table_exists(conn, "MESSAGE"):
                    cols = table_columns(conn, "MESSAGE")
                    if pick(cols, "LID") and pick(cols, "content"):
                        out.append(path)
        except sqlite3.Error:
            continue
    return out


def inspect(decrypted_dir):
    report = []
    for path in iter_sqlite_dbs(decrypted_dir):
        rel = rel_to(decrypted_dir, path)
        item = {"db": rel, "tables": []}
        try:
            with connect_ro(path) as conn:
                tables = [
                    row[0]
                    for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
                    )
                ]
                for table in tables:
                    cols = table_columns(conn, table)
                    count = None
                    if table.upper() in ("MESSAGE", "CONVERSATION", "USER"):
                        try:
                            count = conn.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
                        except sqlite3.Error:
                            pass
                    item["tables"].append({"name": table, "columns": cols, "count": count})
        except sqlite3.Error as exc:
            item["error"] = str(exc)
        report.append(item)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def connect_collector(collector_db):
    conn = sqlite3.connect(collector_db, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    return conn


def chat_summary_expr():
    return (
        "w.chatroom_id, w.chatroom_name, COUNT(m.id) AS messages, "
        "datetime(MIN(m.msg_time),'unixepoch','localtime') AS first_time, "
        "datetime(MAX(m.msg_time),'unixepoch','localtime') AS last_time"
    )


def list_chats(collector_db, pattern="", limit=100):
    with connect_collector(collector_db) as conn:
        where = ""
        params = []
        if pattern:
            where = "WHERE w.chatroom_name LIKE ?"
            params.append(f"%{pattern}%")
        sql = (
            f"SELECT {chat_summary_expr()} "
            "FROM watched_chats w "
            "LEFT JOIN messages m ON m.chatroom_id=w.chatroom_id "
            f"{where} "
            "GROUP BY w.chatroom_id, w.chatroom_name "
            "ORDER BY messages DESC, w.chatroom_name ASC "
            "LIMIT ?"
        )
        params.append(int(limit))
        rows = [dict(row) for row in conn.execute(sql, params)]
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    return rows


def find_chats_by_name(conn, chat_name, fuzzy=False):
    op = "LIKE" if fuzzy else "="
    value = f"%{chat_name}%" if fuzzy else chat_name
    sql = (
        f"SELECT {chat_summary_expr()} "
        "FROM watched_chats w "
        "LEFT JOIN messages m ON m.chatroom_id=w.chatroom_id "
        f"WHERE w.chatroom_name {op} ? "
        "GROUP BY w.chatroom_id, w.chatroom_name "
        "ORDER BY messages DESC, w.chatroom_name ASC"
    )
    return [dict(row) for row in conn.execute(sql, (value,))]


def resolve_chat(conn, chat_name):
    rows = find_chats_by_name(conn, chat_name, fuzzy=False)
    if rows:
        return rows, False
    rows = find_chats_by_name(conn, chat_name, fuzzy=True)
    return rows, True


def infer_output_format(path, default_format):
    if default_format:
        return default_format
    lower = (path or "").lower()
    if lower.endswith(".csv"):
        return "csv"
    if lower.endswith(".jsonl"):
        return "jsonl"
    if lower.endswith(".json"):
        return "json"
    return "table"


def chat_message_rows(conn, chatroom_id, order="asc", limit=0):
    direction = "DESC" if order.lower() == "desc" else "ASC"
    limit_sql = ""
    params = [chatroom_id]
    if limit and int(limit) > 0:
        limit_sql = "LIMIT ?"
        params.append(int(limit))
    sql = (
        "SELECT w.chatroom_name, m.chatroom_id, "
        "datetime(m.msg_time,'unixepoch','localtime') AS time, "
        "m.msg_time, m.sender, m.content, m.msg_type, m.local_id "
        "FROM messages m "
        "JOIN watched_chats w ON w.chatroom_id=m.chatroom_id "
        "WHERE m.chatroom_id=? "
        f"ORDER BY m.msg_time {direction}, m.local_id {direction} "
        f"{limit_sql}"
    )
    return [dict(row) for row in conn.execute(sql, params)]


def write_rows(rows, output_format, output_path=""):
    fields = [
        "chatroom_name",
        "chatroom_id",
        "time",
        "msg_time",
        "sender",
        "content",
        "msg_type",
        "local_id",
    ]
    close_file = False
    fh = sys.stdout
    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        newline = "" if output_format == "csv" else None
        fh = open(output_path, "w", encoding="utf-8-sig" if output_format == "csv" else "utf-8", newline=newline)
        close_file = True
    try:
        if output_format == "csv":
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row.get(key, "") for key in fields})
        elif output_format == "jsonl":
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        elif output_format == "json":
            json.dump(rows, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        else:
            for row in rows:
                fh.write(f"{row.get('time','')}  {row.get('sender','')}  {row.get('content','')}\n")
    finally:
        if close_file:
            fh.close()


def export_chat(
    collector_db,
    chat_name,
    output_path="",
    output_format="",
    limit=None,
    order="desc",
    show_summary=False,
):
    if not collector_db or not os.path.exists(collector_db):
        print(f"[ERROR] collector DB not found: {collector_db}", file=sys.stderr)
        return 1

    output_format = infer_output_format(output_path, output_format)
    with connect_collector(collector_db) as conn:
        chats, fuzzy = resolve_chat(conn, chat_name)
        if not chats:
            print(f"[ERROR] chat not found: {chat_name}", file=sys.stderr)
            return 1
        if len(chats) > 1:
            print(
                f"[ERROR] chat name matched {len(chats)} conversations; use exact name or --list-chats.",
                file=sys.stderr,
            )
            print(json.dumps(chats, ensure_ascii=False, indent=2), file=sys.stderr)
            return 1

        chat = chats[0]
        row_limit = 0 if limit is None and output_path else 50 if limit is None else int(limit)
        rows = chat_message_rows(conn, chat["chatroom_id"], order=order, limit=row_limit)

    summary = {
        "chatroom_id": chat["chatroom_id"],
        "chatroom_name": chat["chatroom_name"],
        "messages": chat["messages"],
        "first_time": chat["first_time"],
        "last_time": chat["last_time"],
        "matched_by": "fuzzy" if fuzzy else "exact",
        "returned": len(rows),
    }
    if output_path:
        write_rows(rows, output_format, output_path)
        summary["output"] = output_path
        summary["format"] = output_format
    else:
        write_rows(rows, output_format, "")
    if show_summary:
        print(json.dumps(summary, ensure_ascii=False, indent=2), file=sys.stderr)
    return 0


def make_chat_id(row):
    conv_id = str(row.get("conv_id") or row.get("RID") or 0)
    message_type = str(row.get("message_type") or 0)
    fw_id = str(row.get("fw_id") or 0)
    return f"wecom:{message_type}:{conv_id}:{fw_id}"


def chat_name(row, conversations):
    conv_id = str(row.get("conv_id") or row.get("RID") or 0)
    message_type = str(row.get("message_type") or 0)
    fw_id = str(row.get("fw_id") or 0)
    return conversations.get((conv_id, message_type, fw_id), f"wecom:{message_type}:{conv_id}:{fw_id}")


def message_content(row):
    content = decode_value(row.get("content"))
    if content:
        return content

    fallback_parts = []
    for key in ("url", "extracontent", "extras"):
        value = decode_value(row.get(key))
        if value:
            fallback_parts.append(value)
    if fallback_parts:
        return " ".join(fallback_parts)
    return f"[content_type {row.get('content_type') or 0}]"


def sender_name(sender_id, names, self_vid=""):
    sender_id = str(sender_id or "")
    name = names.get(sender_id, "")
    if name:
        return name
    if self_vid and sender_id == str(self_vid):
        return "我"
    return sender_id


def row_query(conn, last_lid, limit):
    cols = table_columns(conn, "MESSAGE")
    lookup = colmap(cols)
    select_exprs = []
    for name in MESSAGE_COLUMNS:
        actual = lookup.get(name.lower())
        if actual:
            select_exprs.append(f"[{actual}] AS [{name}]")
        else:
            select_exprs.append(f"NULL AS [{name}]")

    lid_col = pick(cols, "LID")
    if not lid_col:
        return []
    sql = (
        f"SELECT {', '.join(select_exprs)} FROM MESSAGE "
        f"WHERE CAST([{lid_col}] AS INTEGER) > CAST(? AS INTEGER) "
        f"ORDER BY CAST([{lid_col}] AS INTEGER) ASC LIMIT ?"
    )
    cur = conn.execute(sql, (str(last_lid), int(limit)))
    rows = []
    for values in cur.fetchall():
        rows.append(dict(zip(MESSAGE_COLUMNS, values)))
    return rows


def run_sync(decrypted_dir, collector_db, self_vid="", limit=10000, dry_run=False, log_stream=sys.stdout):
    names = load_names(decrypted_dir)
    conversations = load_conversations(decrypted_dir)
    message_dbs = find_message_dbs(decrypted_dir)
    total = 0

    if not message_dbs:
        print("[wecom-sync] no decrypted DB with MESSAGE table found", file=log_stream)
        return 0

    self_vid = str(self_vid or "")
    if dry_run:
        states = {}
    else:
        init_collector_db(collector_db)
        with sqlite3.connect(collector_db, timeout=30) as out:
            out.execute("PRAGMA journal_mode=WAL")
            out.execute("PRAGMA busy_timeout=30000")
            if not self_vid:
                self_vid = infer_self_vid_from_legacy_rows(decrypted_dir, out)
            refresh_watched_chat_names(out, conversations)
            refresh_self_sender_names(out, names, self_vid=self_vid)
            repair_legacy_proto_texts(decrypted_dir, out)
            out.commit()
            states = dict(out.execute("SELECT chatroom_id, last_local_id FROM sync_state").fetchall())

    for path in message_dbs:
        rel = rel_to(decrypted_dir, path)
        state_key = f"__wecom__:{rel}"
        last_lid = states.get(state_key, "0")
        inserted = 0
        new_lid = last_lid

        with connect_ro(path) as conn:
            rows = row_query(conn, last_lid, limit)

        if dry_run:
            print(json.dumps(rows[:20], ensure_ascii=False, indent=2))
            continue

        with sqlite3.connect(collector_db, timeout=30) as out:
            out.execute("PRAGMA busy_timeout=30000")
            out.execute("BEGIN")
            try:
                for row in rows:
                    lid = str(row.get("LID") or "")
                    if not lid:
                        continue
                    cid = make_chat_id(row)
                    cname = chat_name(row, conversations)
                    sender_id = str(row.get("sender_id") or "")
                    sender = sender_name(sender_id, names, self_vid=self_vid)
                    content = message_content(row)[:4000]
                    msg_time = normalize_ts(row.get("send_time"))
                    local_id = f"{rel}:{lid}"
                    content_type = int(row.get("content_type") or 0)

                    upsert_watched_chat(out, cid, cname)
                    out.execute(
                        "INSERT OR IGNORE INTO messages(chatroom_id,sender,content,msg_time,local_id,msg_type) "
                        "VALUES(?,?,?,?,?,?)",
                        (cid, sender, content, msg_time, local_id, content_type),
                    )
                    if out.execute("SELECT changes()").fetchone()[0]:
                        inserted += 1
                    new_lid = lid

                out.execute(
                    "INSERT OR REPLACE INTO sync_state(chatroom_id,last_local_id,last_sync_at) "
                    "VALUES(?,?,strftime('%s','now'))",
                    (state_key, new_lid),
                )
                out.commit()
            except Exception:
                out.rollback()
                raise

        total += inserted
        print(f"[wecom-sync] {rel}: +{inserted}, last LID {new_lid}", file=log_stream)

    print(f"[wecom-sync] complete: {total} new messages", file=log_stream)
    return total


def auto_decrypt_before_read(db_dir, keys_file, decrypted_dir, verbose=False):
    if not db_dir or not os.path.isdir(db_dir):
        if verbose:
            print("[wecom-decrypt] skipped: Enterprise WeChat profile directory not found", file=sys.stderr)
        return 0
    if not keys_file or not os.path.exists(keys_file):
        if verbose:
            print("[wecom-decrypt] skipped: wecom_keys.json not found", file=sys.stderr)
        return 0
    if not decrypted_dir:
        if verbose:
            print("[wecom-decrypt] skipped: decrypted directory not configured", file=sys.stderr)
        return 0

    script_dir = os.path.dirname(os.path.abspath(__file__))
    decrypt_script = os.path.join(script_dir, "decrypt", "decrypt_wecom_db.py")
    cmd = [
        sys.executable,
        decrypt_script,
        "--db-dir",
        db_dir,
        "--keys-file",
        keys_file,
        "--out-dir",
        decrypted_dir,
        "--prefix",
        "Messages1",
    ]
    stream = sys.stderr if verbose else subprocess.DEVNULL
    result = subprocess.run(cmd, stdout=stream, stderr=stream)
    if result.returncode and not verbose:
        print("[ERROR] automatic decrypt failed; rerun with --verbose for details", file=sys.stderr)
    return result.returncode


def auto_sync_before_read(decrypted_dir, collector_db, self_vid="", limit=10000, verbose=False):
    if not decrypted_dir or not os.path.isdir(decrypted_dir):
        if verbose:
            print("[wecom-sync] skipped: decrypted directory not found; using existing collector DB", file=sys.stderr)
        return 0
    if verbose:
        return run_sync(
            decrypted_dir,
            collector_db,
            self_vid=self_vid,
            limit=limit,
            dry_run=False,
            log_stream=sys.stderr,
        )
    with open(os.devnull, "w") as devnull:
        return run_sync(
            decrypted_dir,
            collector_db,
            self_vid=self_vid,
            limit=limit,
            dry_run=False,
            log_stream=devnull,
        )


def parse_args():
    parser = argparse.ArgumentParser(description="Collect Enterprise WeChat messages")
    parser.add_argument("--config", help="wechat-assistant config.yaml")
    parser.add_argument("--db-dir", help="Enterprise WeChat profile directory for automatic decrypt")
    parser.add_argument("--keys-file", help="wecom_keys.json for automatic decrypt")
    parser.add_argument("--decrypted-dir", help="decrypted Enterprise WeChat DB directory")
    parser.add_argument("--collector-db", help="collector.db path")
    parser.add_argument("--self-vid", help="current Enterprise WeChat VID")
    parser.add_argument("--sync", action="store_true", help="decrypt latest Messages1 when possible, then sync messages into collector.db without reading a chat; --chat-name and --list-chats refresh automatically")
    parser.add_argument("--inspect", action="store_true", help="print decrypted DB schemas")
    parser.add_argument("--dry-run", action="store_true", help="print sample MESSAGE rows instead of writing")
    parser.add_argument("--limit", type=int, default=10000, help="max rows per MESSAGE DB")
    parser.add_argument("--list-chats", action="store_true", help="list collected Enterprise WeChat conversations")
    parser.add_argument("--chat-name", help="read/export messages for this Enterprise WeChat conversation name")
    parser.add_argument("--chat-limit", type=int, help="max messages to print/export; default is 50 for stdout and all for files")
    parser.add_argument("--output", help="write chat messages to this file instead of stdout")
    parser.add_argument("--format", choices=("table", "json", "jsonl", "csv"), default="", help="output format")
    parser.add_argument("--order", choices=("asc", "desc"), default="desc", help="message order for --chat-name")
    parser.add_argument("--no-sync", action="store_true", help="skip the default automatic decrypt+sync before --chat-name or --list-chats")
    parser.add_argument("--show-summary", action="store_true", help="print chat summary metadata to stderr")
    parser.add_argument("--verbose", action="store_true", help="print automatic decrypt/sync logs")
    return parser.parse_args()


def main():
    args = parse_args()
    cfg = load_config(args.config) if args.config else {}
    db_dir = args.db_dir or pick_wecom_db_dir(cfg.get("db_dir", ""))
    keys_file = args.keys_file or pick_keys_file(cfg.get("keys_file", ""))
    decrypted_dir = pick_decrypted_dir(args.decrypted_dir, cfg.get("decrypted_dir", ""))
    collector_db = pick_collector_db(args.collector_db, cfg.get("collector_db", ""))
    self_vid = args.self_vid or cfg.get("self_wxid", "")

    needs_decrypted = args.inspect or args.dry_run
    needs_collector = args.sync or args.chat_name or args.list_chats
    did_work = False

    if needs_decrypted and (not decrypted_dir or not os.path.isdir(decrypted_dir)):
        print("[ERROR] missing decrypted directory", file=sys.stderr)
        return 1

    if needs_collector and not collector_db:
        print("[ERROR] missing collector DB path", file=sys.stderr)
        return 1

    if args.inspect:
        inspect(decrypted_dir)
        did_work = True

    if args.sync or args.dry_run:
        if not collector_db and not args.dry_run:
            print("[ERROR] missing collector DB path", file=sys.stderr)
            return 1
        if args.sync:
            rc = auto_decrypt_before_read(db_dir, keys_file, decrypted_dir)
            if rc:
                return rc
            if not decrypted_dir or not os.path.isdir(decrypted_dir):
                print("[ERROR] missing decrypted directory", file=sys.stderr)
                return 1
        run_sync(decrypted_dir, collector_db, self_vid=self_vid, limit=args.limit, dry_run=args.dry_run)
        did_work = True

    should_auto_sync = (args.chat_name or args.list_chats) and not args.no_sync and not args.sync and not args.dry_run
    if should_auto_sync:
        rc = auto_decrypt_before_read(db_dir, keys_file, decrypted_dir, verbose=args.verbose)
        if rc:
            return rc
        auto_sync_before_read(decrypted_dir, collector_db, self_vid=self_vid, limit=args.limit, verbose=args.verbose)

    if args.list_chats:
        if not os.path.exists(collector_db):
            print(f"[ERROR] collector DB not found: {collector_db}", file=sys.stderr)
            return 1
        list_chats(collector_db, pattern=args.chat_name or "", limit=args.chat_limit or 100)
        did_work = True

    if args.chat_name and not args.list_chats:
        rc = export_chat(
            collector_db,
            args.chat_name,
            output_path=args.output or "",
            output_format=args.format or "",
            limit=args.chat_limit,
            order=args.order,
            show_summary=args.show_summary,
        )
        if rc:
            return rc
        did_work = True

    if not did_work:
        print("Use --inspect, --sync, --dry-run, --list-chats, or --chat-name", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
