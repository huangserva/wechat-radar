/*
 * wechat-key-hook.js — Frida hook that harvests WeChat / WXWork DB keys.
 *
 * Fallback for when static memory-pattern scanning (find_all_keys_macos /
 * find_wecom_keys_macos) fails after a WeChat/WXWork version bump changes the
 * in-memory layout. Hooking the crypto API contract is far more stable across
 * versions than scanning byte patterns.
 *
 * Dual strategy (both installed; each is independent — a target usually hits
 * only one):
 *   S1  sqlite3_key / sqlite3_key_v2  — WXWork (企业微信) and older personal
 *       WeChat still route through standard SQLite. The 2nd arg (pKey) IS the
 *       key; sqlite3_db_filename() maps it to a .db path.
 *   S2  CCKeyDerivationPBKDF (CommonCrypto) — newer personal WeChat (e.g. 4.1.8)
 *       embeds crypto in wechat.dylib and does NOT call sqlite3_key. Filter
 *       algorithm==kCCPBKDF2(2) && prf==kCCPRFHmacAlgSHA512(5) && rounds>1000.
 *       Conservative F5 handling: the raw key may be the password INPUT (args[1])
 *       or the DERIVED output (args[7]) depending on build — we emit BOTH,
 *       tagged, and let a real device confirm which one decrypts.
 *
 * Frida 17 API only: Module.getGlobalExportByName / Process.getModuleByName().
 * findExportByName — never the removed Module.findExportByName(name, sym).
 *
 * Lineage: memory-scan sibling ylytdeng/wechat-decrypt find_wxwork_keys.py
 * (Windows-only); WXWork sqlite3_key hook approach documented at 看雪 (kanxue)
 * thread-289242. This file only READS key bytes and send()s them out — it never
 * writes plaintext DBs.
 *
 * Output: send({ strategy, db, key_hex, len }) per unique key.
 */
'use strict';

const seen = new Set();

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function emit(strategy, keyHex, len, db) {
  if (!keyHex || keyHex.length === 0) return;
  const dedupe = strategy + '|' + (db || '') + '|' + keyHex;
  if (seen.has(dedupe)) return;
  seen.add(dedupe);
  send({ strategy: strategy, db: db || null, key_hex: keyHex, len: len });
}

/** Resolve an export by name across all loaded modules (Frida 17 API). */
function resolveExport(name) {
  let p = null;
  try {
    p = Module.getGlobalExportByName(name);
  } catch (e) {
    p = null;
  }
  if (p) return p;
  // Fall back to scanning each module (handles non-global / embedded exports).
  try {
    const mods = Process.enumerateModules();
    for (let i = 0; i < mods.length; i++) {
      const ep = mods[i].findExportByName(name);
      if (ep) return ep;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

// --- sqlite3_db_filename(db, "main") → NativeFunction for db→path mapping. ---
let dbFilenameFn = null;
(function initDbFilename() {
  const p = resolveExport('sqlite3_db_filename');
  if (!p) return;
  try {
    dbFilenameFn = new NativeFunction(p, 'pointer', ['pointer', 'pointer']);
  } catch (e) {
    dbFilenameFn = null;
  }
})();

function dbNameFor(dbHandle) {
  if (!dbFilenameFn || dbHandle.isNull()) return null;
  try {
    const mainStr = Memory.allocUtf8String('main');
    const res = dbFilenameFn(dbHandle, mainStr);
    if (res.isNull()) return null;
    const s = res.readUtf8String();
    return s && s.length > 0 ? s : null;
  } catch (e) {
    return null;
  }
}

function readKeyHex(pKey, nKey) {
  if (pKey.isNull() || nKey <= 0 || nKey > 512) return null;
  try {
    return toHex(pKey.readByteArray(nKey));
  } catch (e) {
    return null;
  }
}

// --- S1: sqlite3_key(db, pKey, nKey) & sqlite3_key_v2(db, zDb, pKey, nKey) ---
let s1 = 0;
(function hookSqlite3Key() {
  const pKeyFn = resolveExport('sqlite3_key');
  if (pKeyFn) {
    try {
      Interceptor.attach(pKeyFn, {
        onEnter(args) {
          const keyHex = readKeyHex(args[1], args[2].toInt32());
          emit('sqlite3_key', keyHex, args[2].toInt32(), dbNameFor(args[0]));
        },
      });
      s1++;
    } catch (e) { /* ignore */ }
  }
  const pKeyV2 = resolveExport('sqlite3_key_v2');
  if (pKeyV2) {
    try {
      Interceptor.attach(pKeyV2, {
        onEnter(args) {
          // sqlite3_key_v2(db, zDbName, pKey, nKey)
          const keyHex = readKeyHex(args[2], args[3].toInt32());
          emit('sqlite3_key_v2', keyHex, args[3].toInt32(), dbNameFor(args[0]));
        },
      });
      s1++;
    } catch (e) { /* ignore */ }
  }
})();

// --- S2: CCKeyDerivationPBKDF — newer personal WeChat ---
let s2 = 0;
(function hookPbkdf() {
  const fn = resolveExport('CCKeyDerivationPBKDF');
  if (!fn) return;
  try {
    Interceptor.attach(fn, {
      onEnter(args) {
        // int CCKeyDerivationPBKDF(algo, password, passwordLen, salt, saltLen,
        //                          prf, rounds, derivedKey, derivedKeyLen)
        const algo = args[0].toInt32();
        const prf = args[5].toInt32();
        const rounds = args[6].toInt32();
        if (algo !== 2 || prf !== 5 || rounds <= 1000) return; // kCCPBKDF2 + HmacSHA512
        this.match = true;
        // Conservative F5: emit the password input now...
        const pwHex = readKeyHex(args[1], args[2].toInt32());
        emit('pbkdf_password', pwHex, args[2].toInt32(), null);
        // ...and remember the derivedKey out-pointer for onLeave.
        this.derivedPtr = args[7];
        this.derivedLen = args[8].toInt32();
      },
      onLeave() {
        if (!this.match) return;
        const dHex = readKeyHex(this.derivedPtr, this.derivedLen);
        emit('pbkdf_derived', dHex, this.derivedLen, null);
      },
    });
    s2++;
  } catch (e) { /* ignore */ }
})();

send({
  strategy: '_ready',
  db: null,
  key_hex: '',
  len: 0,
  hooks: { sqlite3_key: s1, pbkdf: s2, db_filename: dbFilenameFn ? 1 : 0 },
});
