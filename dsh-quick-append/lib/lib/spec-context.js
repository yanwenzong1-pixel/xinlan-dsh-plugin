/**
 * 规范上下文增量缓存 —— 「追加」按钮上下文加载优化。
 *
 * 范围：项目根 5 份规范 + docs/ 全部文档 + 各插件 SPEC/README/DESIGN；
 * 缓存：<$DSH_HOME|~/.dsh>/dsh-quick-append/spec-cache/<cwd-hash12>/（manifest.json + spec-context.cache gzip），
 *       不写入源仓库、不进对话历史；
 * 失效：任一源 mtime/size 变化、源缺失、manifest 或缓存损坏 → 全量重建（原子写，损坏不抛）；
 * 净化：剔除「更新日志/变更记录/操作日志/运行摘要/存储点快照/验收清单/路线图/设计过程回顾」等
 *       非约束章节（标题级），保留规则条款与全部关键标识（ID/令牌/事件名/z-index/白名单项）。
 * 纯 node 模块：无 DOM/React 依赖，可被 node --test 直接断言。
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
/** 项目根目录固定规范清单。 */
export const ROOT_SPECS = [
    'README.md',
    'plugin-design-spec-template.md',
    'PLUGIN-LOADER-SPEC.md',
    'CANVAS-INTERACTION-SPEC.md',
    'JSON-CSS-SPEC.md',
];
/** 插件目录内按序尝试的文档名。 */
const PLUGIN_DOC_NAMES = ['SPEC.md', 'README.md', 'DESIGN.md'];
/** 主题标题映射（正文分段标题尽量与原文档章节对应）。 */
const TOPIC_OF = {
    'PLUGIN-LOADER-SPEC.md': '强制装配规范',
    'plugin-design-spec-template.md': 'UI 视觉规范',
    'CANVAS-INTERACTION-SPEC.md': '画布互动规则',
    'JSON-CSS-SPEC.md': 'JSON/CSS 结构化规范',
    'README.md': '项目概览',
};
/** 非约束性章节标题关键词（标题级剔除）。 */
const EXCLUDE_SECTION_RE = /更新日志|变更记录|变更历史|改版记录|操作日志|运行摘要|存储点快照|验收清单|路线图|Roadmap|设计过程回顾|维护记录/i;
const CACHE_VERSION = 1;
/** 默认上下文预算（字符，≈60k token 安全档）：超限按「整文件优先保留」策略裁剪（根规范 > docs > 插件目录）。 */
export const DEFAULT_BUDGET_CHARS = 240_000;
/**
 * 解析 DSH 家目录，优先级与 harness（`@deepseek-ai/dsh-home-paths`）一致：
 * explicit > `$DSH_HOME` > `~/.dsh`；**纯空白 `$DSH_HOME` 视为未设**。
 *
 * 这一条是隔离验证的前提：只认 `homedir()` 会让显式设置了 `DSH_HOME` 的调用方
 * 仍然写到真实 `~/.dsh`，使「隔离验证」失去意义。
 */
export function resolveDshHome(env = process.env) {
    const fromEnv = env.DSH_HOME;
    return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh');
}
/** 默认缓存目录：用户级插件数据目录 + cwd 哈希，永不在源仓库内。 */
export function defaultCacheDir(cwd) {
    const h = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
    return join(resolveDshHome(), 'dsh-quick-append', 'spec-cache', h);
}
async function statFile(abs, rel) {
    try {
        const st = await stat(abs);
        if (!st.isFile())
            return null;
        return { rel, abs, mtimeMs: st.mtimeMs, size: st.size };
    }
    catch {
        return null;
    }
}
/** 发现全部规范源（缺失/目录不存在一律跳过，不抛错）。 */
export async function discoverSources(cwd) {
    const out = [];
    for (const name of ROOT_SPECS) {
        const f = await statFile(join(cwd, name), name);
        if (f)
            out.push(f);
    }
    try {
        const entries = await readdir(join(cwd, 'docs'), { withFileTypes: true });
        for (const e of entries) {
            if (!e.isFile() || !e.name.endsWith('.md'))
                continue;
            const f = await statFile(join(cwd, 'docs', e.name), `docs/${e.name}`);
            if (f)
                out.push(f);
        }
    }
    catch { /* docs 目录不存在 */ }
    try {
        const plugins = await readdir(join(cwd, 'plugins'), { withFileTypes: true });
        for (const p of plugins) {
            if (!p.isDirectory() || p.name.startsWith('.'))
                continue;
            for (const name of PLUGIN_DOC_NAMES) {
                const f = await statFile(join(cwd, 'plugins', p.name, name), `plugins/${p.name}/${name}`);
                if (f)
                    out.push(f);
            }
        }
    }
    catch { /* plugins 目录不存在 */ }
    return out;
}
/** 标题级剔除非约束章节 + 连续空行压缩；首尾 trim。 */
export function cleanDoc(text) {
    if (!text)
        return '';
    const lines = text.split('\n');
    const kept = [];
    let skipping = false;
    for (const line of lines) {
        const m = /^(#{1,6})\s+(.+)$/.exec(line);
        if (m) {
            skipping = EXCLUDE_SECTION_RE.test(m[2]);
            if (!skipping)
                kept.push(line);
            continue;
        }
        if (!skipping)
            kept.push(line);
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function topicOf(rel) {
    return TOPIC_OF[rel] ?? rel;
}
async function readCleaned(files) {
    const sections = [];
    for (const f of files) {
        let text = '';
        try {
            text = cleanDoc(await readFile(f.abs, 'utf8'));
        }
        catch {
            continue;
        }
        if (!text)
            continue;
        sections.push({ f, section: `## ${topicOf(f.rel)}\n\n${text}` });
    }
    return { sections };
}
async function writeFileAtomic(abs, data) {
    const tmp = `${abs}.tmp-${process.pid}`;
    await writeFile(tmp, data);
    await rename(tmp, abs);
}
/** 全量构建（读→净化→预算裁剪→压缩→原子写缓存与 manifest）。写失败不抛：回退为全量结果。 */
async function buildFull(files, cacheDir, budgetChars) {
    const { sections } = await readCleaned(files);
    if (sections.length === 0) {
        return { ok: false, content: '', files: [], cacheHit: false, loadSource: 'full', reason: 'all-sections-filtered', omitted: [] };
    }
    // 整文件原子保留（优先序 = 发现序：根规范 > docs > 插件目录），保保留文件标识完整
    const parts = [];
    const kept = [];
    const omitted = [];
    let used = 0;
    for (const { f, section } of sections) {
        if (used + section.length > budgetChars) {
            omitted.push(f.rel);
            continue;
        }
        parts.push(section);
        kept.push(f);
        used += section.length;
    }
    if (parts.length === 0) {
        return { ok: true, content: '', files: [], cacheHit: false, loadSource: 'full', reason: 'budget-too-small', omitted };
    }
    let content = parts.join('\n\n');
    if (omitted.length > 0) {
        content = `${content}\n\n（规范超限省略，未载入：${omitted.join(', ')}；需完整约束请单独读取对应文档）`;
    }
    const manifest = {
        version: CACHE_VERSION,
        budgetChars,
        contentHash: createHash('sha256').update(content).digest('hex'),
        /** 失效判定用：全部发现源（含被预算省略的）。 */
        sources: files.map(f => ({ rel: f.rel, mtimeMs: f.mtimeMs, size: f.size })),
        /** 实际载入顺序（预算裁剪后）。 */
        kept: kept.map(f => f.rel),
    };
    try {
        await mkdir(cacheDir, { recursive: true });
        await writeFileAtomic(join(cacheDir, 'spec-context.cache'), gzipSync(Buffer.from(content)));
        await writeFileAtomic(join(cacheDir, 'manifest.json'), JSON.stringify(manifest));
    }
    catch {
        return { ok: true, content, files: kept, cacheHit: false, loadSource: 'full', reason: 'cache-write-failed', omitted };
    }
    return { ok: true, content, files: kept, cacheHit: false, loadSource: 'full', reason: 'built', omitted };
}
function manifestMatches(files, manifestFiles) {
    if (files.length !== manifestFiles.length)
        return false;
    for (let i = 0; i < files.length; i += 1) {
        const a = files[i];
        const b = manifestFiles[i];
        if (a.rel !== b.rel || Math.round(a.mtimeMs) !== Math.round(b.mtimeMs) || a.size !== b.size)
            return false;
    }
    return true;
}
/**
 * 增量加载：mtime/manifest/缓存完整 → 命中；否则全量重建。
 * 任何异常都被捕获：缓存不可用自动回退全量，绝不抛错。
 */
export async function loadSpecContext(cwd, opts = {}) {
    const files = await discoverSources(cwd);
    if (files.length === 0) {
        return { ok: false, content: '', files: [], cacheHit: false, loadSource: 'full', reason: 'no-spec-sources', omitted: [] };
    }
    const budgetChars = opts.budgetChars ?? DEFAULT_BUDGET_CHARS;
    const cacheDir = opts.cacheDir ?? defaultCacheDir(cwd);
    try {
        const manifestRaw = await readFile(join(cacheDir, 'manifest.json'), 'utf8');
        const manifest = JSON.parse(manifestRaw);
        if (manifest.version === CACHE_VERSION
            && manifest.budgetChars === budgetChars
            && typeof manifest.contentHash === 'string'
            && Array.isArray(manifest.sources)
            && Array.isArray(manifest.kept)
            && manifestMatches(files, manifest.sources)) {
            const content = gunzipSync(await readFile(join(cacheDir, 'spec-context.cache'))).toString('utf8');
            // 缓存内容与 manifest 哈希一致性校验：合法 gzip 但内容错写（半写/误写）也判失效重建
            if (createHash('sha256').update(content).digest('hex') !== manifest.contentHash)
                throw new Error('cache content mismatch');
            const kept = manifest.kept.filter(rel => files.some(f => f.rel === rel));
            const loaded = files.filter(f => kept.includes(f.rel));
            const omitted = files.filter(f => !kept.includes(f.rel)).map(f => f.rel);
            return { ok: true, content, files: loaded, cacheHit: true, loadSource: 'cache', reason: 'hit', omitted };
        }
    }
    catch { /* 损坏/缺失/哈希不符 → 走全量 */ }
    return buildFull(files, cacheDir, budgetChars);
}
/** 组装提示词正文：清单头（文件+mtime+命中标记）+ 主题分段正文。 */
export function formatSpecContext(r) {
    if (!r.ok)
        return '（规范上下文：本目录未发现规范文档）';
    const mark = r.cacheHit ? '缓存命中' : '全量加载';
    const header = [
        '本次载入规范清单：',
        ...r.files.map(f => `- ${f.rel} (mtime=${Math.round(f.mtimeMs)}, ${mark})`),
    ].join('\n');
    const note = !r.cacheHit ? '\n（缓存失效，本次为全量加载）' : '';
    return `${header}${note}\n\n${r.content}`;
}
//# sourceMappingURL=spec-context.js.map