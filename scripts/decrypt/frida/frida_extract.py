#!/usr/bin/env python3
"""
frida_extract.py — Frida fallback key extractor for wechat-radar.

Drives wechat-key-hook.js against a running WeChat / WXWork process, collects
the key bytes the hook send()s out, and writes a keys JSON in the SAME shape as
find_all_keys_macos / find_wecom_keys_macos so the downstream decrypters
(decrypt_db.py / decrypt_wecom_db.py) consume it unchanged:

    { "rel/path.db": {"enc_key": "<hex>"}, ... }

Keys captured without a DB association (the CCKeyDerivationPBKDF path has no
sqlite handle) go under "_candidate_keys" — an underscore-prefixed key that
decrypt_db's strip_key_metadata() ignores; match_keys.py resolves them against
DBs by page-1 HMAC.

Permission model (方案 A): this is the command radar GENERATES for the user to
run; radar never runs it. Frida attach on macOS needs root + a debuggable target
(ad-hoc re-sign + get-task-allow, or SIP disabled) — the same class of
prerequisite as the C scanners.

Capture timing: hooks only see DBs opened AFTER attach. Use --spawn to launch the
app under Frida and capture every open from process start (complete but restarts
the app); default attach is non-invasive but may need you to open a chat / switch
account to trigger fresh DB opens.

Lineage: memory-scan sibling ylytdeng/wechat-decrypt find_wxwork_keys.py
(Windows-only); WXWork sqlite3_key hook approach at 看雪 thread-289242.

This tool only prints/writes keys; it never decrypts or prints message content.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK_JS = os.path.join(HERE, "wechat-key-hook.js")

# Default process names per target (macOS).
TARGET_PROCESSES = {
    "personal": ["WeChat"],
    "wecom": ["WXWork", "企业微信", "WeWork"],
}


def _rel_path(db_path, db_dir):
    """Normalize an absolute DB path to the rel key that decrypt_* expects."""
    if not db_path:
        return None
    p = db_path.replace("\\", "/")
    if db_dir:
        try:
            rel = os.path.relpath(p, db_dir)
            if not rel.startswith(".."):
                return rel.replace("\\", "/")
        except ValueError:
            pass
    # Heuristics matching the scanners' rel roots.
    for marker in ("db_storage/",):
        idx = p.find(marker)
        if idx != -1:
            return p[idx + len(marker):]
    idx = p.find("Profiles/")
    if idx != -1:
        tail = p[idx + len("Profiles/"):]
        # strip the "<profile-id>/" segment
        parts = tail.split("/", 1)
        return parts[1] if len(parts) == 2 else tail
    return os.path.basename(p)


def _resolve_target(session_target, target_kind):
    if session_target:
        return session_target
    names = TARGET_PROCESSES.get(target_kind, [])
    return names[0] if names else None


def main(argv=None):
    parser = argparse.ArgumentParser(description="Frida fallback WeChat key extractor")
    parser.add_argument("--target", choices=("personal", "wecom"), default="personal",
                        help="which app to hook (selects default process name)")
    parser.add_argument("--process", help="explicit process name or PID (overrides --target default)")
    parser.add_argument("--spawn", help="bundle id / path to spawn under Frida (complete capture, restarts app)")
    parser.add_argument("--db-dir", help="DB root for rel-path normalization (optional)")
    parser.add_argument("--out", required=True, help="keys JSON output path (same format as find_all_keys)")
    parser.add_argument("--timeout", type=float, default=20.0, help="seconds to collect before writing (default 20)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    try:
        import frida
    except ImportError:
        print("[ERROR] frida not installed. Run: pip install -r "
              "scripts/decrypt/frida/requirements-frida.txt", file=sys.stderr)
        return 3

    if not os.path.exists(HOOK_JS):
        print(f"[ERROR] hook script missing: {HOOK_JS}", file=sys.stderr)
        return 3

    with open(HOOK_JS, encoding="utf-8") as f:
        js_source = f.read()

    keyed = {}            # rel -> {"enc_key": hex}
    candidates = []       # [{"key_hex","strategy","len"}]
    ready_info = {}

    def on_message(message, data):
        if message.get("type") != "send":
            if args.verbose:
                print(f"[frida] {message}", file=sys.stderr)
            return
        payload = message.get("payload") or {}
        strategy = payload.get("strategy")
        if strategy == "_ready":
            ready_info.update(payload.get("hooks") or {})
            print(f"[frida] hooks installed: {ready_info}", file=sys.stderr)
            return
        key_hex = payload.get("key_hex")
        if not key_hex:
            return
        db = payload.get("db")
        if db:
            rel = _rel_path(db, args.db_dir)
            if rel:
                keyed[rel] = {"enc_key": key_hex}
                if args.verbose:
                    print(f"[frida] {strategy} {rel} <- key", file=sys.stderr)
                return
        candidates.append({"key_hex": key_hex, "strategy": strategy, "len": payload.get("len")})
        if args.verbose:
            print(f"[frida] {strategy} candidate key (no db)", file=sys.stderr)

    device = frida.get_local_device()
    session = None
    pid_to_resume = None
    try:
        if args.spawn:
            pid_to_resume = device.spawn([args.spawn])
            session = device.attach(pid_to_resume)
        else:
            proc = args.process or _resolve_target(args.process, args.target)
            if proc is None:
                print("[ERROR] no target process resolved", file=sys.stderr)
                return 3
            try:
                proc = int(proc)  # allow PID
            except (TypeError, ValueError):
                pass
            session = device.attach(proc)
    except frida.ProcessNotFoundError:
        print(f"[ERROR] target process not running (start {args.target} WeChat first)", file=sys.stderr)
        return 4
    except frida.PermissionDeniedError:
        print("[ERROR] permission denied — Frida attach needs root + a debuggable target "
              "(ad-hoc re-sign + get-task-allow, or SIP disabled). See README.", file=sys.stderr)
        return 5
    except Exception as exc:  # noqa: BLE001 — surface any attach failure clearly
        print(f"[ERROR] attach/spawn failed: {exc}", file=sys.stderr)
        return 5

    script = session.create_script(js_source)
    script.on("message", on_message)
    script.load()
    if pid_to_resume is not None:
        device.resume(pid_to_resume)

    deadline = time.time() + args.timeout
    while time.time() < deadline:
        time.sleep(0.2)

    try:
        script.unload()
        session.detach()
    except Exception:
        pass

    out = dict(keyed)
    if candidates:
        out["_candidate_keys"] = candidates
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    os.replace(tmp, args.out)

    print(f"[frida] wrote {len(keyed)} keyed + {len(candidates)} candidate key(s) -> {args.out}",
          file=sys.stderr)
    if not keyed and not candidates:
        print("[frida] 0 keys captured — try --spawn for full capture, or open a chat to "
              "trigger DB opens after attach.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
