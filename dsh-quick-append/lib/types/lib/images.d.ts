/**
 * 客户端图片「发送前校验与轻量压缩」决策纯逻辑（无 DOM，可单测）。
 * 实际画布重编码（createImageBitmap + canvas + toBlob JPEG）在 client 组件中执行；
 * 本模块只负责确定性决策与降级提示文案，保证行为可测试。
 *
 * 口径（v0.3.0）：
 * - png/jpeg/webp 且 ≤4MB → 原样发送（keep）；
 * - png/jpeg/webp 且 >4MB → 重编码（最长边 ≤2048 + JPEG 质量 0.85）；
 * - gif → 重编码（静态首帧，模型通道兼容）；
 * - 其他格式/空文件 → 剔除；全部剔除 → 降级为纯文本优化并给出可见提示。
 */
/** 原样发送的字节上限（超过 → 重编码压缩）。 */
export declare const PREPROCESS_MAX_BYTES: number;
/** 重编码最长边像素上限。 */
export declare const REENCODE_MAX_DIMENSION = 2048;
/** 重编码 JPEG 质量。 */
export declare const REENCODE_QUALITY = 0.85;
/** 单张图片预处理计划。 */
export type ImagePlan = {
    ok: true;
    action: 'keep' | 'reencode';
    mediaType: string;
} | {
    ok: false;
    reason: 'unsupported-image-type' | 'empty-image';
};
/** 浏览器文件最小形状（File 结构兼容）。 */
export interface ImageFileLike {
    type: string;
    size: number;
}
/** 单张图片发送前决策：keep / reencode / 剔除（不支持格式、空文件）。 */
export declare function planImage(file: ImageFileLike): ImagePlan;
/**
 * 图片预处理结果提示（可见提示文案，纯函数）：
 * - 全部失败 → 降级纯文本提示；部分失败 → 数量说明；无图片/全部成功 → null。
 */
export declare function buildPreprocessNote(attempted: number, okCount: number): string | null;
