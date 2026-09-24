/**
 * @dsh-external/dsh-quick-append — host half (v0.3.1).
 *
 * v0.3.1（宿主策略单点）：
 * - **模型与思考强度由宿主决定**：默认 `deepseek-flash`（DeepSeek-V41-Flash，适配器目录
 *   contextWindow 与 vision-exp 同为 1M 档、inputModalities 含 image ⇒ 图片通道不丢）、
 *   思考强度默认 `max`。客户端不再发送 `model` / `reasoningEffort`，弹窗不再暴露控件。
 *   payload 仍接受这两个字段（向后兼容旧客户端），经归一化兜底到上述默认值。
 * - 多模态：客户端上传图片（base64）经 ctx.attachments.saveImage 准入生成 ImageAttachmentRef，
 *   与正文按序合并进同一条 user 消息（harness 多模态消息协议 ImageBlock）；
 *   全部图片准入失败 → 降级纯文本并在结果中标注「未采纳图片信息」（响应 imagesDropped=true）。
 * - 容错：输出为 JSON 信封 {"optimized","imageNote"}，解析走 extractJSON 多路兜底；
 *   瞬态失败（调用错误/超时/空输出/解析失败）重试 2 次（共 3 次尝试）；末次仍有非空正文 → 纯文本兜底；
 *   单次尝试超时 600s（1M 上下文 + 思考模式上调）；客户端断开立即中止上游流（不烧 token）。
 * - 证据日志：console.log 输出 model / reasoningEffort / contextWindow（1M 档位核查）。
 */
import type { Context } from 'cordis';
export declare const name = "@dsh-external/dsh-quick-append";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
