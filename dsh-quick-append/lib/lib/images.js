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
export const PREPROCESS_MAX_BYTES = 4 * 1024 * 1024;
/** 重编码最长边像素上限。 */
export const REENCODE_MAX_DIMENSION = 2048;
/** 重编码 JPEG 质量。 */
export const REENCODE_QUALITY = 0.85;
const KEEP_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** 需要重编码的媒体类型（gif 静态首帧）。 */
const REENCODE_MEDIA_TYPES = ['image/gif'];
/** 单张图片发送前决策：keep / reencode / 剔除（不支持格式、空文件）。 */
export function planImage(file) {
    const type = typeof file?.type === 'string' ? file.type : '';
    const size = file?.size ?? Number.NaN;
    if (!Number.isFinite(size) || size <= 0)
        return { ok: false, reason: 'empty-image' };
    if (KEEP_MEDIA_TYPES.includes(type)) {
        return { ok: true, action: size > PREPROCESS_MAX_BYTES ? 'reencode' : 'keep', mediaType: type };
    }
    if (REENCODE_MEDIA_TYPES.includes(type)) {
        return { ok: true, action: 'reencode', mediaType: type };
    }
    return { ok: false, reason: 'unsupported-image-type' };
}
/**
 * 图片预处理结果提示（可见提示文案，纯函数）：
 * - 全部失败 → 降级纯文本提示；部分失败 → 数量说明；无图片/全部成功 → null。
 */
export function buildPreprocessNote(attempted, okCount) {
    const a = Number.isFinite(attempted) && attempted >= 0 ? Math.floor(attempted) : 0;
    const ok = Number.isFinite(okCount) && okCount >= 0 ? Math.floor(okCount) : 0;
    if (a === 0)
        return null;
    if (ok === 0)
        return '图片处理失败，已按纯文本优化';
    if (ok < a)
        return `${a} 张图片中 ${a - ok} 张处理失败，仅发送 ${ok} 张`;
    return null;
}
//# sourceMappingURL=images.js.map