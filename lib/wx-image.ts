import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as fsp from 'node:fs/promises';

// Node 22+ ships fs.promises.glob but TS types lag behind
const glob = (fsp as unknown as {
  glob: (pattern: string, opts: { cwd: string }) => AsyncIterable<string>;
}).glob;

const WX_CACHE_ROOT = join(
  homedir(),
  'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files',
);

let _userDirCache: string | null = null;

/** 找到当前登录微信用户目录（取最近修改的） */
function findUserDir(): string | null {
  if (_userDirCache && existsSync(_userDirCache)) return _userDirCache;
  if (!existsSync(WX_CACHE_ROOT)) return null;
  const entries = readdirSync(WX_CACHE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'all_users' && e.name !== 'Backup')
    .map((e) => {
      const p = join(WX_CACHE_ROOT, e.name);
      return { p, mtime: statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) return null;
  _userDirCache = entries[0].p;
  return _userDirCache;
}

/** 列出按月分的子目录，按时间倒序（最近月份优先） */
function listMonthDirs(userDir: string): string[] {
  const cacheDir = join(userDir, 'cache');
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir)
    .filter((d) => /^\d{4}-\d{2}$/.test(d))
    .sort((a, b) => b.localeCompare(a));
}

export interface ResolvedImage {
  path: string;
  type: 'hd' | 'mid' | 'thumb';
  format: 'png' | 'jpeg' | 'gif' | 'bmp' | 'bin';
}

/** 检测文件 magic bytes */
function detectFormat(path: string): ResolvedImage['format'] {
  try {
    const fd = readFileSync(path, { flag: 'r' });
    const h = fd.subarray(0, 4);
    if (h[0] === 0xff && h[1] === 0xd8) return 'jpeg';
    if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'png';
    if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return 'gif';
    if (h[0] === 0x42 && h[1] === 0x4d) return 'bmp';
  } catch {}
  return 'bin';
}

// 月份 → { localId → ResolvedImage } 索引（懒加载）
const monthIndexCache = new Map<string, Map<number, ResolvedImage>>();
const monthIndexLoading = new Map<string, Promise<void>>();

async function buildMonthIndex(userDir: string, month: string): Promise<void> {
  if (monthIndexCache.has(month)) return;
  const existing = monthIndexLoading.get(month);
  if (existing) return existing;

  const p = (async () => {
    const monthRoot = join(userDir, 'cache', month, 'Message');
    if (!existsSync(monthRoot)) {
      monthIndexCache.set(month, new Map());
      return;
    }
    const idx = new Map<number, ResolvedImage>();
    const priority: Record<ResolvedImage['type'], number> = { hd: 3, mid: 2, thumb: 1 };

    const consider = (path: string, type: ResolvedImage['type']) => {
      const m = /\/(\d+)_/.exec(path);
      if (!m) return;
      const id = Number(m[1]);
      const cur = idx.get(id);
      if (!cur || priority[type] > priority[cur.type]) {
        // 推迟 detectFormat 到实际请求时
        idx.set(id, { path, type, format: 'bin' });
      }
    };

    for await (const p of glob('*/ImageTemp/*hd_temp_convert', { cwd: monthRoot })) {
      consider(join(monthRoot, String(p)), 'hd');
    }
    for await (const p of glob('*/ImageTemp/*mid_temp_convert', { cwd: monthRoot })) {
      consider(join(monthRoot, String(p)), 'mid');
    }
    for await (const p of glob('*/Thumb/*thumb.jpg', { cwd: monthRoot })) {
      consider(join(monthRoot, String(p)), 'thumb');
    }
    monthIndexCache.set(month, idx);
  })();

  monthIndexLoading.set(month, p);
  await p;
  monthIndexLoading.delete(month);
}

/**
 * 按 local_id 在 wx 缓存找图。优先 hint 月份，否则按月扫到旧。
 * 用懒加载的内存索引加速：每月扫一次后命中 ~1ms。
 */
export async function resolveWxImage(
  localId: number,
  hintMonth?: string,
): Promise<ResolvedImage | null> {
  const userDir = findUserDir();
  if (!userDir) return null;

  const months = listMonthDirs(userDir);
  if (months.length === 0) return null;

  const ordered = hintMonth && months.includes(hintMonth)
    ? [hintMonth, ...months.filter((m) => m !== hintMonth)]
    : months;

  for (const m of ordered) {
    await buildMonthIndex(userDir, m);
    const idx = monthIndexCache.get(m);
    if (!idx) continue;
    const hit = idx.get(localId);
    if (hit) {
      return { ...hit, format: detectFormat(hit.path) };
    }
  }
  return null;
}

const MIME: Record<ResolvedImage['format'], string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  bin: 'application/octet-stream',
};

export function mimeFor(format: ResolvedImage['format']): string {
  return MIME[format];
}
