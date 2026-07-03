/* -------------------------------------------------------------------------
 * VENDORED — DO NOT EDIT LOGIC. Verbatim copy for clean upstream re-sync.
 * Source: Hermes `wechat-assistant` decrypt toolchain (scripts/decrypt/).
 * Upstream kernel credited by that toolchain: ylytdeng/wechat-decrypt
 * Vendored into wechat-radar 2026-07-03 (M7). See scripts/decrypt/PROVENANCE.md.
 * Original author copyright/notices retained. Only this header block was added.
 * ------------------------------------------------------------------------- */
/*
 * find_wecom_keys_macos.c - macOS Enterprise WeChat key scanner
 *
 * Enterprise WeChat 5.x for macOS stores local DBs in a wxSQLite3-style
 * AES-128-CBC page format. The raw DB key is 16 bytes. This scanner reads the
 * running Enterprise WeChat process memory, looks for the wxSQLite3 codec
 * object layout observed in the macOS 5.0.8 x86_64 binary, and validates each
 * candidate key against encrypted DB page 1 before writing wecom_keys.json.
 *
 * Build:
 *   cc -O2 -Wall -Wextra -o find_wecom_keys_macos find_wecom_keys_macos.c
 *
 * Usage:
 *   ./find_wecom_keys_macos [pid] [db_dir] [out_json]
 *
 * Notes:
 *   - If task_for_pid fails, run through sudo and ensure macOS allows debugger
 *     access to the Enterprise WeChat process.
 *   - This tool prints/writes keys, but never decrypts or prints messages.
 */

#define _XOPEN_SOURCE 700

#include <CommonCrypto/CommonCryptor.h>
#include <CommonCrypto/CommonDigest.h>
#include <dirent.h>
#include <errno.h>
#include <ftw.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <pwd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define WX_PAGE_SIZE 4096
#define MAX_DBS 512
#define CHUNK_SIZE (4 * 1024 * 1024)
#define OVERLAP_SIZE 0x200

typedef struct {
    char rel[512];
    char path[1024];
    unsigned char page1[WX_PAGE_SIZE];
    unsigned char key[16];
    uint64_t key_addr;
    uint64_t size;
    int key_found;
} db_entry_t;

static db_entry_t g_dbs[MAX_DBS];
static int g_db_count = 0;
static char g_db_base[1024];

static int has_wxsqlite3_plain_header_fragment(const unsigned char *page) {
    int page_size = (page[16] << 8) | page[17];
    if (page_size == 1) page_size = 65536;
    return page_size >= 512 &&
           page_size <= 65536 &&
           (page_size & (page_size - 1)) == 0 &&
           page[21] == 0x40 &&
           page[22] == 0x20 &&
           page[23] == 0x20;
}

static int is_plain_sqlite_page(const unsigned char *page) {
    return memcmp(page, "SQLite format 3", 15) == 0;
}

static uint32_t modmult(uint32_t a, uint32_t b, uint32_t c, uint32_t m, uint32_t s) {
    uint32_t q = s / a;
    int64_t next = (int64_t)b * (s - a * q) - (int64_t)c * q;
    if (next < 0) next += m;
    return (uint32_t)next;
}

static void put_u32_le(unsigned char *out, uint32_t v) {
    out[0] = (unsigned char)(v & 0xff);
    out[1] = (unsigned char)((v >> 8) & 0xff);
    out[2] = (unsigned char)((v >> 16) & 0xff);
    out[3] = (unsigned char)((v >> 24) & 0xff);
}

static void generate_initial_vector(uint32_t page_no, unsigned char out[16]) {
    uint32_t z = page_no + 1;
    unsigned char initkey[16];
    for (int i = 0; i < 4; i++) {
        z = modmult(52774, 40692, 3791, 2147483399U, z);
        put_u32_le(initkey + i * 4, z);
    }
    CC_MD5(initkey, sizeof(initkey), out);
}

static void derive_page_key(const unsigned char raw_key[16], uint32_t page_no,
                            unsigned char out[16]) {
    unsigned char material[24];
    memcpy(material, raw_key, 16);
    put_u32_le(material + 16, page_no);
    memcpy(material + 20, "sAlT", 4);
    CC_MD5(material, sizeof(material), out);
}

static int looks_like_sqlite_page1(const unsigned char *page) {
    unsigned char btree = page[100];
    return memcmp(page, "SQLite format 3\0", 16) == 0 &&
           (btree == 0x02 || btree == 0x05 || btree == 0x0a || btree == 0x0d);
}

static int verify_wxsqlite3_key(const unsigned char raw_key[16],
                                const unsigned char page1[WX_PAGE_SIZE]) {
    if (is_plain_sqlite_page(page1) || !has_wxsqlite3_plain_header_fragment(page1)) {
        return 0;
    }

    unsigned char work[WX_PAGE_SIZE];
    unsigned char decrypted_tail[WX_PAGE_SIZE - 16];
    unsigned char page_key[16];
    unsigned char iv[16];
    unsigned char header_fragment[8];
    size_t out_len = 0;

    memcpy(work, page1, WX_PAGE_SIZE);
    memcpy(header_fragment, work + 16, sizeof(header_fragment));
    memcpy(work + 16, work + 8, 8);

    derive_page_key(raw_key, 1, page_key);
    generate_initial_vector(1, iv);

    CCCryptorStatus st = CCCrypt(kCCDecrypt, kCCAlgorithmAES, 0,
                                 page_key, sizeof(page_key), iv,
                                 work + 16, WX_PAGE_SIZE - 16,
                                 decrypted_tail, sizeof(decrypted_tail),
                                 &out_len);
    if (st != kCCSuccess || out_len != WX_PAGE_SIZE - 16) {
        return 0;
    }

    memcpy(work + 16, decrypted_tail, sizeof(decrypted_tail));
    if (memcmp(work + 16, header_fragment, sizeof(header_fragment)) != 0) {
        return 0;
    }
    memcpy(work, "SQLite format 3\0", 16);
    return looks_like_sqlite_page1(work);
}

static int key_has_entropy(const unsigned char key[16]) {
    int seen[256] = {0};
    int unique = 0;
    int all_zero = 1;
    for (int i = 0; i < 16; i++) {
        if (key[i] != 0) all_zero = 0;
        if (!seen[key[i]]) {
            seen[key[i]] = 1;
            unique++;
        }
    }
    return !all_zero && unique >= 6;
}

static void hex16(const unsigned char data[16], char out[33]) {
    static const char *hex = "0123456789abcdef";
    for (int i = 0; i < 16; i++) {
        out[i * 2] = hex[data[i] >> 4];
        out[i * 2 + 1] = hex[data[i] & 0x0f];
    }
    out[32] = '\0';
}

static int path_ends_with(const char *s, const char *suffix) {
    size_t sl = strlen(s);
    size_t tl = strlen(suffix);
    return sl >= tl && strcmp(s + sl - tl, suffix) == 0;
}

static int collect_db_cb(const char *fpath, const struct stat *sb,
                         int typeflag, struct FTW *ftwbuf) {
    (void)ftwbuf;
    if (typeflag != FTW_F || !path_ends_with(fpath, ".db")) {
        return 0;
    }
    if (g_db_count >= MAX_DBS || sb->st_size < WX_PAGE_SIZE) {
        return 0;
    }

    FILE *fp = fopen(fpath, "rb");
    if (!fp) return 0;

    unsigned char page1[WX_PAGE_SIZE];
    size_t n = fread(page1, 1, WX_PAGE_SIZE, fp);
    fclose(fp);
    if (n != WX_PAGE_SIZE) return 0;
    if (is_plain_sqlite_page(page1) || !has_wxsqlite3_plain_header_fragment(page1)) {
        return 0;
    }

    db_entry_t *db = &g_dbs[g_db_count++];
    memset(db, 0, sizeof(*db));
    strncpy(db->path, fpath, sizeof(db->path) - 1);
    memcpy(db->page1, page1, WX_PAGE_SIZE);
    db->size = (uint64_t)sb->st_size;

    size_t base_len = strlen(g_db_base);
    const char *rel = fpath;
    if (strncmp(fpath, g_db_base, base_len) == 0) {
        rel = fpath + base_len;
        if (*rel == '/') rel++;
    }
    strncpy(db->rel, rel, sizeof(db->rel) - 1);
    printf("  DB: %s (%.1fMB)\n", db->rel, (double)db->size / 1024.0 / 1024.0);
    return 0;
}

static int collect_dbs(const char *db_dir) {
    strncpy(g_db_base, db_dir, sizeof(g_db_base) - 1);
    g_db_base[sizeof(g_db_base) - 1] = '\0';
    g_db_count = 0;
    if (nftw(db_dir, collect_db_cb, 32, FTW_PHYS) != 0) {
        fprintf(stderr, "nftw failed for %s: %s\n", db_dir, strerror(errno));
        return -1;
    }
    return g_db_count;
}

static const char *user_home(void) {
    const char *home = getenv("HOME");
    const char *sudo_user = getenv("SUDO_USER");
    if (sudo_user && *sudo_user) {
        struct passwd *pw = getpwnam(sudo_user);
        if (pw && pw->pw_dir) home = pw->pw_dir;
    }
    return home ? home : ".";
}

static void default_db_dir(char out[1024]) {
    snprintf(out, 1024, "%s/Library/Containers/com.tencent.WeWorkMac/Data/Documents/Profiles",
             user_home());
}

static pid_t find_wecom_pid(void) {
    const char *cmds[] = {
        "pgrep -f '/Applications/企业微信.app/Contents/MacOS/企业微信' | head -n 1",
        "pgrep -x '企业微信' | head -n 1",
        "pgrep -f 'WeWork' | head -n 1",
        NULL,
    };
    for (int i = 0; cmds[i]; i++) {
        FILE *fp = popen(cmds[i], "r");
        if (!fp) continue;
        char buf[64];
        pid_t pid = -1;
        if (fgets(buf, sizeof(buf), fp)) pid = (pid_t)atoi(buf);
        pclose(fp);
        if (pid > 0) return pid;
    }
    return -1;
}

static int read_task_u64(mach_port_t task, uint64_t addr, uint64_t *out) {
    mach_vm_size_t out_size = 0;
    kern_return_t kr = mach_vm_read_overwrite(task, (mach_vm_address_t)addr, 8,
        (mach_vm_address_t)out, &out_size);
    return kr == KERN_SUCCESS && out_size == 8;
}

static int read_task_u32(mach_port_t task, uint64_t addr, uint32_t *out) {
    mach_vm_size_t out_size = 0;
    kern_return_t kr = mach_vm_read_overwrite(task, (mach_vm_address_t)addr, 4,
        (mach_vm_address_t)out, &out_size);
    return kr == KERN_SUCCESS && out_size == 4;
}

static int looks_like_user_pointer(uint64_t p) {
    return p > 0x100000000ULL && p < 0x0000800000000000ULL;
}

static int valid_page_size(uint32_t page_size) {
    return page_size == 512 || page_size == 1024 || page_size == 2048 ||
           page_size == 4096 || page_size == 8192 || page_size == 16384 ||
           page_size == 32768 || page_size == 65536;
}

static int wx_cipher_page_size(mach_port_t task, const unsigned char *candidate,
                               uint32_t *page_size_out) {
    uint64_t ptr38;
    memcpy(&ptr38, candidate + 0x38, sizeof(ptr38));
    if (!looks_like_user_pointer(ptr38)) return 0;

    uint64_t page_obj_holder = 0;
    uint32_t page_size = 0;
    if (!read_task_u64(task, ptr38 + 0x8, &page_obj_holder)) return 0;
    if (!looks_like_user_pointer(page_obj_holder)) return 0;
    if (!read_task_u32(task, page_obj_holder + 0x34, &page_size)) return 0;
    if (!valid_page_size(page_size)) return 0;

    *page_size_out = page_size;
    return 1;
}

static int keys_equal(const unsigned char a[16], const unsigned char b[16]) {
    return memcmp(a, b, 16) == 0;
}

static int record_candidate_key(const unsigned char key[16], uint64_t addr,
                                const char *source, uint32_t page_size) {
    if (!key_has_entropy(key)) return 0;

    int matched = 0;
    for (int i = 0; i < g_db_count; i++) {
        if (g_dbs[i].key_found && keys_equal(g_dbs[i].key, key)) {
            continue;
        }
        if (verify_wxsqlite3_key(key, g_dbs[i].page1)) {
            memcpy(g_dbs[i].key, key, 16);
            g_dbs[i].key_addr = addr;
            g_dbs[i].key_found = 1;
            matched++;
        }
    }

    if (matched) {
        char key_hex[33];
        hex16(key, key_hex);
        printf("\n  [FOUND] %s key=%s addr=0x%llx page_size=%u matched=%d\n",
               source, key_hex, (unsigned long long)addr, page_size, matched);
        for (int i = 0; i < g_db_count; i++) {
            if (g_dbs[i].key_found && keys_equal(g_dbs[i].key, key)) {
                printf("    %s\n", g_dbs[i].rel);
            }
        }
    }
    return matched;
}

static int all_dbs_have_keys(void) {
    if (g_db_count == 0) return 0;
    for (int i = 0; i < g_db_count; i++) {
        if (!g_dbs[i].key_found) return 0;
    }
    return 1;
}

static int is_hex_char(unsigned char c) {
    return (c >= '0' && c <= '9') ||
           (c >= 'a' && c <= 'f') ||
           (c >= 'A' && c <= 'F');
}

static int hex_value(unsigned char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int parse_hex_key(const unsigned char *hex, unsigned char out[16]) {
    for (int i = 0; i < 32; i++) {
        if (!is_hex_char(hex[i])) return 0;
    }
    for (int i = 0; i < 16; i++) {
        int hi = hex_value(hex[i * 2]);
        int lo = hex_value(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return 0;
        out[i] = (unsigned char)((hi << 4) | lo);
    }
    return 1;
}

static int scan_ascii_hex_keys(const unsigned char *buf, size_t len, uint64_t base) {
    int tests = 0;
    for (size_t i = 0; i + 35 < len; i++) {
        if (buf[i] != 'x' || buf[i + 1] != '\'') continue;

        size_t j = i + 2;
        while (j < len && is_hex_char(buf[j])) j++;
        if (j >= len || buf[j] != '\'' || j - (i + 2) < 32) continue;

        unsigned char key[16];
        if (parse_hex_key(buf + i + 2, key)) {
            tests++;
            record_candidate_key(key, base + i + 2, "ascii", 0);
        }
    }
    return tests;
}

static int scan_cipher_structs(mach_port_t task, const unsigned char *buf,
                               size_t len, uint64_t base) {
    int tests = 0;
    if (len < 0x48) return 0;

    for (size_t off = 0; off + 0x48 <= len; off += 4) {
        uint32_t flag0 = 0, flag4 = 0, active = 0;
        uint32_t page_size = 0;
        uint64_t ptr30 = 0;

        memcpy(&flag0, buf + off, sizeof(flag0));
        memcpy(&flag4, buf + off + 4, sizeof(flag4));
        memcpy(&active, buf + off + 0x18, sizeof(active));
        memcpy(&ptr30, buf + off + 0x30, sizeof(ptr30));

        if (!(flag0 >= 1 && flag0 <= 4)) continue;
        if (!(flag4 <= 4)) continue;
        if (!(active <= 2)) continue;
        if (!looks_like_user_pointer(ptr30)) continue;
        if (!wx_cipher_page_size(task, buf + off, &page_size)) continue;

        tests++;
        record_candidate_key(buf + off + 0x08, base + off + 0x08, "cipher+0x08", page_size);
        tests++;
        record_candidate_key(buf + off + 0x1c, base + off + 0x1c, "cipher+0x1c", page_size);
        if (all_dbs_have_keys()) return tests;
    }
    return tests;
}

static int scan_process_memory(mach_port_t task) {
    unsigned char *buf = (unsigned char *)malloc(CHUNK_SIZE + OVERLAP_SIZE);
    if (!buf) {
        fprintf(stderr, "malloc failed\n");
        return -1;
    }

    uint64_t total_scanned = 0;
    int region_count = 0;
    int struct_tests = 0;
    int ascii_tests = 0;

    mach_vm_address_t addr = 0;
    while (1) {
        mach_vm_size_t size = 0;
        vm_region_basic_info_data_64_t info;
        mach_msg_type_number_t info_count = VM_REGION_BASIC_INFO_COUNT_64;
        mach_port_t object_name = MACH_PORT_NULL;

        kern_return_t kr = mach_vm_region(task, &addr, &size, VM_REGION_BASIC_INFO_64,
            (vm_region_info_t)&info, &info_count, &object_name);
        if (kr != KERN_SUCCESS) break;
        if (size == 0) {
            addr++;
            continue;
        }

        if ((info.protection & VM_PROT_READ) && (info.protection & VM_PROT_WRITE)) {
            region_count++;
            mach_vm_address_t ca = addr;
            unsigned char overlap[OVERLAP_SIZE];
            size_t overlap_len = 0;

            while (ca < addr + size) {
                mach_vm_size_t remaining = (addr + size) - ca;
                mach_vm_size_t want = remaining > CHUNK_SIZE ? CHUNK_SIZE : remaining;
                mach_vm_size_t out_size = 0;

                kr = mach_vm_read_overwrite(task, ca, want,
                    (mach_vm_address_t)(buf + overlap_len), &out_size);
                if (kr == KERN_SUCCESS && out_size > 0) {
                    if (overlap_len) {
                        memcpy(buf, overlap, overlap_len);
                    }
                    size_t scan_len = overlap_len + (size_t)out_size;
                    uint64_t scan_base = (uint64_t)ca - overlap_len;

                    total_scanned += out_size;
                    ascii_tests += scan_ascii_hex_keys(buf, scan_len, scan_base);
                    struct_tests += scan_cipher_structs(task, buf, scan_len, scan_base);

                    overlap_len = scan_len < OVERLAP_SIZE ? scan_len : OVERLAP_SIZE;
                    memcpy(overlap, buf + scan_len - overlap_len, overlap_len);

                    if (all_dbs_have_keys()) {
                        free(buf);
                        printf("\nAll DBs matched. Scanned %lluMB in %d regions. tests: struct=%d ascii=%d\n",
                               (unsigned long long)(total_scanned / 1024 / 1024),
                               region_count, struct_tests, ascii_tests);
                        return 0;
                    }
                }

                ca += want;
            }
        }

        mach_vm_address_t next = addr + size;
        if (next <= addr) break;
        addr = next;
    }

    free(buf);
    printf("\nScan complete. Scanned %lluMB in %d regions. tests: struct=%d ascii=%d\n",
           (unsigned long long)(total_scanned / 1024 / 1024),
           region_count, struct_tests, ascii_tests);
    return 0;
}

static void json_escape(FILE *fp, const char *s) {
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') fputc('\\', fp);
        fputc(*s, fp);
    }
}

static int save_results(const char *out_path, const char *db_dir) {
    FILE *fp = fopen(out_path, "w");
    if (!fp) {
        fprintf(stderr, "cannot write %s: %s\n", out_path, strerror(errno));
        return -1;
    }

    fprintf(fp, "{\n");
    fprintf(fp, "  \"_format\": \"wxSQLite3 AES-128-CBC\",\n");
    fprintf(fp, "  \"_db_dir\": \"");
    json_escape(fp, db_dir);
    fprintf(fp, "\"");

    int saved = 0;
    for (int i = 0; i < g_db_count; i++) {
        if (!g_dbs[i].key_found) continue;

        char key_hex[33], salt_hex[33];
        hex16(g_dbs[i].key, key_hex);
        hex16(g_dbs[i].page1, salt_hex);

        fprintf(fp, ",\n  \"");
        json_escape(fp, g_dbs[i].rel);
        fprintf(fp, "\": {\"enc_key\": \"%s\", \"salt\": \"%s\", \"size_mb\": %.1f, \"addr\": \"0x%llx\"}",
                key_hex, salt_hex, (double)g_dbs[i].size / 1024.0 / 1024.0,
                (unsigned long long)g_dbs[i].key_addr);
        saved++;
    }
    fprintf(fp, "\n}\n");
    fclose(fp);
    chmod(out_path, 0600);

    printf("\nSaved %d/%d DB keys to %s\n", saved, g_db_count, out_path);
    for (int i = 0; i < g_db_count; i++) {
        if (!g_dbs[i].key_found) {
            printf("  MISSING: %s\n", g_dbs[i].rel);
        }
    }
    return saved > 0 ? 0 : -1;
}

int main(int argc, char **argv) {
    pid_t pid = -1;
    char db_dir[1024];
    const char *out_path = "wecom_keys.json";

    if (argc >= 2) pid = (pid_t)atoi(argv[1]);
    if (pid <= 0) pid = find_wecom_pid();
    if (pid <= 0) {
        fprintf(stderr, "Enterprise WeChat process not found. Pass PID explicitly.\n");
        return 1;
    }

    if (argc >= 3) {
        strncpy(db_dir, argv[2], sizeof(db_dir) - 1);
        db_dir[sizeof(db_dir) - 1] = '\0';
    } else {
        default_db_dir(db_dir);
    }
    if (argc >= 4) out_path = argv[3];

    printf("============================================================\n");
    printf("  macOS Enterprise WeChat Key Scanner\n");
    printf("============================================================\n");
    printf("PID: %d\n", pid);
    printf("DB dir: %s\n", db_dir);
    printf("Output: %s\n\n", out_path);

    printf("Collecting encrypted Enterprise WeChat DBs...\n");
    int dbs = collect_dbs(db_dir);
    if (dbs <= 0) {
        fprintf(stderr, "No wxSQLite3-encrypted .db files found under %s\n", db_dir);
        return 1;
    }
    printf("Found %d encrypted DBs\n\n", dbs);

    mach_port_t task = MACH_PORT_NULL;
    kern_return_t kr = task_for_pid(mach_task_self(), pid, &task);
    if (kr != KERN_SUCCESS) {
        fprintf(stderr, "task_for_pid failed: %d\n", kr);
        fprintf(stderr, "Try running with sudo and make sure debugger access is allowed.\n");
        return 1;
    }
    printf("Got task port: %u\n", task);
    printf("Scanning readable/writable memory for validated wxSQLite3 keys...\n");

    if (scan_process_memory(task) != 0) {
        return 1;
    }
    return save_results(out_path, db_dir) == 0 ? 0 : 1;
}
