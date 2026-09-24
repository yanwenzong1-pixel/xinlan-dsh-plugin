/**
 * 提示词优化链路纯逻辑（无 IO，可单测；Host/Client 共用）。
 *
 * v0.3.1 契约：
 * - 默认模型 deepseek-flash（DeepSeek-V41-Flash；适配器目录 contextWindow 与
 *   deepseek-v4-flash-vision-exp 同为默认 1M 档，且 inputModalities 含 image ⇒ 图片通道不丢）。
 * - 思考强度默认 max。**模型与思考强度是宿主策略**：客户端不再发送这两个字段，
 *   弹窗也不再暴露对应控件（避免"界面可覆盖"与"需求锁定"两套语义并存）。
 * - 输出为 JSON 信封 {"optimized": "...", "imageNote": "..."}；解析走 extractJSON 多路兜底；
 *   瞬态失败（调用错误/超时/空输出/解析失败）重试 2 次（共 3 次尝试）；末次仍失败 → 纯文本兜底。
 * - 单次尝试超时 OPTIMIZE_TIMEOUT_MS（1M 上下文 + 思考模式上调，避免长输入被超时打断）。
 */
/** 默认优化模型（需求锁定：deepseek-flash；如需换档，改此处并同步 host-optimize 门禁）。 */
export declare const DEFAULT_OPTIMIZE_MODEL = "deepseek-flash";
/** 优化调用提供商路由（不变）。 */
export declare const OPTIMIZE_PROVIDER = "deepseek-official";
/** 思考强度枚举（llm-deepseek 适配器实际支持的档位）。 */
export declare const REASONING_EFFORTS: readonly ["off", "low", "high", "max"];
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
/** 默认思考强度：max（需求：思考强度拉满）。 */
export declare const DEFAULT_REASONING_EFFORT: ReasoningEffort;
/** 失败重试 2 次 = 共 3 次尝试。 */
export declare const OPTIMIZE_MAX_ATTEMPTS = 3;
/** 单次尝试超时（ms）：按 1M 上下文与思考模式实际耗时上调。 */
export declare const OPTIMIZE_TIMEOUT_MS = 600000;
/**
 * 客户端 `/api/optimize` 请求体的字段契约（单一事实来源）。
 *
 * `model` / `reasoningEffort` 曾在此列，v0.3.1 起由宿主默认策略接管而移除；
 * 断言见 `test/optimize.test.mjs` 与 `test/client-shape.test.mjs`。
 */
export declare const OPTIMIZE_REQUEST_FIELDS: readonly ["draft", "context", "cwd", "images"];
/** 模型标识归一化：缺失/空白/非法字符/超长 → 默认模型；合法 → 去首尾空白。 */
export declare function normalizeModel(input: unknown): string;
/** 思考强度归一化：枚举内通过；其余（含大小写不符）→ 默认 max。 */
export declare function normalizeReasoningEffort(input: unknown): ReasoningEffort;
/**
 * extractJSON 多路兜底（纯函数）：① 整体解析；② markdown 代码围栏内（含 json 标注）；
 * ③ 首 { 到尾 } 子串；④ 平衡扫描取第一个完整对象。全部失败 → null。
 */
export declare function extractJSON(text: unknown): unknown;
/** 优化结果（解析成功）。 */
export interface ParsedOptimizeResult {
    /** 优化后的工程化提示词正文（已去首尾空白）。 */
    optimized: string;
    /** 图片信息采纳情况说明（无/空 → null）。 */
    imageNote: string | null;
}
/** 从 JSON 信封解析优化结果：optimized 必须为非空字符串；其余形状 → null（触发重试/兜底）。 */
export declare function parseOptimizeResult(text: unknown): ParsedOptimizeResult | null;
/** 纯文本兜底：非空文本直接作为优化结果（末次解析失败时的最后一路）。 */
export declare function plainTextFallback(text: unknown): ParsedOptimizeResult | null;
/** 重试失败分类：transient=可重试；client-aborted=客户端取消（永不重试）；none=无失败。 */
export type RetryFailure = {
    kind: 'transient';
} | {
    kind: 'client-aborted';
} | null;
/** 失败重试判定：仅瞬态失败且未耗尽 2 次重试（attempt 0/1 → 重试，attempt 2 → 终止）。 */
export declare function retryDecision(failure: RetryFailure, attempt: number): boolean;
/** 优化 System 约束：图片语义规则 + JSON 输出契约 + 确定性规则（temperature 0 由调用方保证）。 */
export declare function buildOptimizeSystemPrompt(): string;
/** 优化 user 文本：正文 + 规范上下文 + 最近对话上下文完整承载（不做截断）。 */
export declare function buildOptimizeUserText(draft: string, specText: string, context: string): string;
/** 客户端上传的图片 payload（base64）。 */
export interface OptimizeImagePayload {
    mediaType: string;
    data: string;
    name?: string;
}
/**
 * 图片 payload 校验：仅保留 mediaType 合法且 data 非空的条目；
 * 存在被剔除条目 → dropped=true（供降级提示）；未提供 images/非数组 → 空列表 + dropped=false。
 */
export declare function validateImagePayloads(raw: unknown): {
    images: OptimizeImagePayload[];
    dropped: boolean;
};
