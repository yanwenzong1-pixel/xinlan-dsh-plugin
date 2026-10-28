# 占位符对照表（安装时按这张表全局替换）

> 规则：安装时把包内所有 `{{…}}` 替换成你自己的值；替换完在包目录里搜 `{{`，**应只剩本文件的示例**。
> 替换顺序建议：先 `{{REPO_ROOT}}` / `{{USER_HOME}}`（路径类）→ 再服务与仓库类 → 最后 id 类。

| 占位符 | 含义 | 示例（假值） | 从哪取 |
|---|---|---|---|
| `{{REPO_ROOT}}` | 业务仓绝对路径（技能、协议目录、脚本都在这下面） | `D:\work\my-repo` | 你克隆仓库的位置 |
| `{{REPO_NAME}}` | 业务仓名（GitHub 上传槽位描述用） | `my-repo` | 仓库目录名 |
| `{{USER_HOME}}` | 用户主目录 | `<用户主目录>` | `echo $env:USERPROFILE` |
| `{{DSH_HOME}}` | DSH 数据主目录（credentials、profiles、日志） | `D:\dsh-home` | `echo $env:DSH_HOME`（未设则用 `~/.dsh`） |
| `{{DSH_CHECKOUT}}` | DSH 源码 checkout 路径 | `D:\dsh\repo` | 你部署 DSH 的位置 |
| `{{DSH_HELPER_DIR}}` | 本机 DSH 辅助工具箱目录（重启 broker / 接收器 / 看门狗脚本所在） | `<运维脚本目录>` | 你自己的运维脚本目录；**没有就删掉相关段落** |
| `{{QUOTE_REPO}}` | 行情/采集仓名（若有独立的行情服务仓） | `quote-repo` | 你的仓库名 |
| `{{QUOTE_REPO_PATH}}` | 行情仓绝对路径 | `D:\work\quote-repo` | 你克隆的位置 |
| `{{QUOTE_SERVICE_HOST}}` | 远端行情服务主机（若行情服务不在本机） | `10.0.0.5` | 你的服务地址；**本机自建就改成 `127.0.0.1`** |
| `{{QUOTE_SERVICE_PORT}}` | 远端行情服务端口 | `8095` | 同上 |
| `{{CRASH_SESSION_ID}}` | 崩溃报告槽位对应的会话 id | `session-xxxxxxxx-…` | `node relay-dispatch.mjs check` 输出里的 `id=` |
| `{{SESSION_ID_1}}` `{{SESSION_ID_2}}` `{{SESSION_ID_3}}` | 历史换手记录里的会话 id（仅注释残留） | `session-aaaaaaaa-…` | 可整段删除，不影响功能 |
| `{{DEV_PORT}}` | 开发面 Web 端口（示例中会出现 3080/3090 之类的数字） | `3080` | `automation.config.json` 的 `ports.dev` |
| `{{RELEASE_PORT}}` | 发布面 Web 端口 | `8091` | `automation.config.json` 的 `ports.release` |
| `{{PUBLIC_DOMAIN}}` | 发布面公网域名（若有） | `example.com` | 你的域名 |

## 说明

1. **包内保留的端口数字**（如 `3080`、`8091`）是**示例默认值**，不是隐私；安装时按你的 `automation.config.json` 改成实际端口即可。
2. 包内**没有**用户名、私有仓 slug、远端 IP、真实公网域名、真实会话 id —— 这些在打包时已替换为占位符（见 `PRIVACY-SCRUB.md`）。
3. 若某个占位符在你的环境里**不存在对应物**（例如没有独立的行情仓、没有辅助工具箱），把提到它的句子**整段删掉**，不要留着空占位符 —— 否则后来人会以为"必须配"。
