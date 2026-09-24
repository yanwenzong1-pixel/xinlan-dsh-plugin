/** 项目根目录固定规范清单。 */
export declare const ROOT_SPECS: readonly string[];
export interface SourceFile {
    /** 相对项目根的路径（清单与正文标题用）。 */
    rel: string;
    abs: string;
    mtimeMs: number;
    size: number;
}
export interface SpecLoadResult {
    ok: boolean;
    content: string;
    files: SourceFile[];
    cacheHit: boolean;
    loadSource: 'cache' | 'full';
    reason: string;
    /** 因预算超限被省略的文件（整文件省略，保保留文件标识完整）。 */
    omitted: string[];
}
/** 默认上下文预算（字符，≈60k token 安全档）：超限按「整文件优先保留」策略裁剪（根规范 > docs > 插件目录）。 */
export declare const DEFAULT_BUDGET_CHARS = 240000;
/**
 * 解析 DSH 家目录，优先级与 harness（`@deepseek-ai/dsh-home-paths`）一致：
 * explicit > `$DSH_HOME` > `~/.dsh`；**纯空白 `$DSH_HOME` 视为未设**。
 *
 * 这一条是隔离验证的前提：只认 `homedir()` 会让显式设置了 `DSH_HOME` 的调用方
 * 仍然写到真实 `~/.dsh`，使「隔离验证」失去意义。
 */
export declare function resolveDshHome(env?: NodeJS.ProcessEnv): string;
/** 默认缓存目录：用户级插件数据目录 + cwd 哈希，永不在源仓库内。 */
export declare function defaultCacheDir(cwd: string): string;
/** 发现全部规范源（缺失/目录不存在一律跳过，不抛错）。 */
export declare function discoverSources(cwd: string): Promise<SourceFile[]>;
/** 标题级剔除非约束章节 + 连续空行压缩；首尾 trim。 */
export declare function cleanDoc(text: string): string;
/**
 * 增量加载：mtime/manifest/缓存完整 → 命中；否则全量重建。
 * 任何异常都被捕获：缓存不可用自动回退全量，绝不抛错。
 */
export declare function loadSpecContext(cwd: string, opts?: {
    cacheDir?: string;
    budgetChars?: number;
}): Promise<SpecLoadResult>;
/** 组装提示词正文：清单头（文件+mtime+命中标记）+ 主题分段正文。 */
export declare function formatSpecContext(r: SpecLoadResult): string;
