/**
 * @dsh-external/dsh-ptc-task —— PTC 子代理工位。
 *
 * 形态：主 agent 保持原生工具面；把「步骤事先能说清、中途不需要看结果再决定」的多步任务
 * 交给一个**工具以 PTC(code) 模式呈现**的子代理：它写一段 TypeScript 程序经 `run_code`
 * 组合多步操作，中间输出留在程序里，只有结论回到上下文。
 *
 * 为什么需要它：PTC 是 per-scope 的呈现方式（`ctx.tools.presentAs(mode)`，最近作用域生效），
 * 进程级开关（`DSH_TOOLS_MODE`）会把主 agent 也切过去。本插件用 `setup(agentCtx)` 只在
 * **子代理作用域**声明 code 模式，主会话原生不动。
 *
 * 两条实测踩过的坑，代码里都做了兜底：
 * 1. 子代理的 prompt 会把 `{{model}}`/`{{cwd}}` 严格插值到 `agent.options` 上
 *    （packages/core/agent-loop/src/index.ts: `ctx.systemPrompt.variable('model', c => c.agent?.options.model)`）。
 *    所以**必须**把调用方的 provider/model 继承给子代理（官方 resolveChildAgentOptions 语义）；
 *    空 options 会让子代理第一步就 turn/end error，且请求从未发出（0 token、0 工具调用）——
 *    看起来像"跑完了没产物"，实际是"根本没开始"。解析不到路由时本工具直接报错，不派发。
 * 2. 子代理可能"看起来空闲"却什么都没做，所以返回前读它自己的 `turn/end` 原因；
 *    `turnEnd` 以 `error:` 开头即判定 `ok: false`。
 */
import type { Context } from 'cordis';
import z from 'schemastery';
export declare const name = "@dsh-external/dsh-ptc-task";
/** `agents`（创建子代理）、`tools`（作用域内呈现方式）、`timer`（墙钟上限）都是硬依赖。 */
export declare const inject: string[];
export interface Config {
    /** 子代理挂载的 agent preset：它决定子代理的工具面与人格。默认 `ptc-code`。 */
    preset: string;
    /** 调用方未显式传 `budgetMs` 时的墙钟上限（毫秒）。 */
    defaultBudgetMs: number;
    /**
     * 子代理作用域内**拒绝**的全局工具名（默认 `['ptc_task']` = 禁止递归派发）。
     * 只对全局工具有效；预设行注册的 scoped 工具（subagent/workflow/ralph 等）不归它管。
     * 名字必须是真实存在的全局工具，否则 `restrict()` 会拒绝——拒绝原因会写进 `setupNote`。
     */
    denyTools: string[];
    /**
     * **递归护栏装不上时是否拒绝派发**（默认 `true` = fail-closed）。
     *
     * 【为什么必须默认拒绝（2026-09-17 死循环缺陷）】旧实现把 `restrict()` 的异常写成一行
     * `setupNote` 后**照常派发**：护栏没装上时子代理仍可再调 `ptc_task`，于是每层再派 N 个、
     * 指数级重复执行同一件事。护栏是**终止性前提**而不是"nice to have"，缺了它宁可不起子代理。
     * 显式把 `denyTools` 配成空数组 = 主动声明"不要护栏"⇒ 本项不生效（保持兼容）。
     */
    requireRecursionGuard: boolean;
    /**
     * 同一任务**连续失败**达到该次数后熔断（默认 3；`0` = 关闭）。
     *
     * 【为什么需要】失败返回值里的提示本身就在邀请调用方"重派"，而插件侧没有任何计数上限
     * ⇒ create→fail→create 可以无限循环。熔断把这条回路截断，并明确告诉调用方"别再自动重派"。
     */
    maxConsecutiveFailures: number;
    /** 熔断窗口（毫秒，默认 600000 = 10 分钟）：超过窗口的旧失败不计入连续失败。 */
    circuitWindowMs: number;
}
export declare const Config: z<Schemastery.ObjectS<{
    preset: z<string, string>;
    defaultBudgetMs: z<number, number>;
    denyTools: z<string[], string[]>;
    requireRecursionGuard: z<boolean, boolean>;
    maxConsecutiveFailures: z<number, number>;
    circuitWindowMs: z<number, number>;
}>, Schemastery.ObjectT<{
    preset: z<string, string>;
    defaultBudgetMs: z<number, number>;
    denyTools: z<string[], string[]>;
    requireRecursionGuard: z<boolean, boolean>;
    maxConsecutiveFailures: z<number, number>;
    circuitWindowMs: z<number, number>;
}>>;
/**
 * 注册 `ptc_task`。
 * @param ctx - 挂载作用域上下文（本插件装在宿主侧，工具对所有会话可见）。
 * @param config - 子代理 preset 与默认预算。
 */
export declare function apply(ctx: Context, config: Config): void;
