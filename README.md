# xinlan-dsh-plugin

DSH（DeepSeek Harness）外部插件集合。每个插件是独立的 npm 包，通过自带的
`cordis.patch.yml` 接入 DSH 宿主的 profile，构建产物（`lib/`）已随仓库提交，
clone 后无需先行构建即可加载。

## 插件

| 目录 | 包名 | 版本 | 一句话作用 |
| --- | --- | --- | --- |
| `dsh-quick-append/` | `@dsh-external/dsh-quick-append` | 0.5.1 | 输入框「快速追加」按钮，按工作区隔离的预存文案与预存命令 |
| `dsh-dialogue-alert-message/` | `@dsh-external/dsh-dialogue-alert-message` | 0.1.1 | 对话执行状态监控与报警音，附 DeepSeek 账号用量显示 |
| `dsh-ptc-task/` | `@dsh-external/dsh-ptc-task` | 0.1.0 | 把一整件事交给 PTC 作用域子代理执行的任务派发工具 |

每个插件的**介绍、用法与注意事项**见其目录下的 `README.md`：

- [`dsh-quick-append/README.md`](dsh-quick-append/README.md)
- [`dsh-dialogue-alert-message/README.md`](dsh-dialogue-alert-message/README.md)
- [`dsh-ptc-task/README.md`](dsh-ptc-task/README.md)

## 仓库结构

```
dsh-quick-append/            插件：宿主侧 src/index.ts、客户端 src/client/、构建产物 lib/、测试 test/
dsh-dialogue-alert-message/  同上（另含 SPEC.md、integration-check.mjs）
dsh-ptc-task/                纯宿主插件：src/index.ts + lib/index.js，无客户端半
docs/                        设计与迭代记录（Markdown、界面截图）
```

每个插件目录内的固定文件：

- `cordis.patch.yml` —— 把该插件插入 profile 层栈的 bundle patch（宿主接入凭据）
- `scripts/build.ps1` —— 构建入口，PowerShell 脚本
- `lib/` —— 已提交的构建产物（含 `lib/types/*.d.ts` 与 sourcemap）

## 接入方式

三个插件都走同一套契约：**包名进 profile 的 `dsh.profile.bundles`，包内必须有
`dsh.bundle.patch` 指向真实存在的 `cordis.patch.yml`**。二者缺一，宿主加载 profile
时会直接报 `profile bundle "<pkg>" declares no dsh.bundle in its package.json` 并退出——
爆炸半径是整个 dsh-web，而不是「这个插件不生效」。细节见各插件 README 的接入章节。

## 构建与测试

```powershell
cd dsh-<plugin>
pnpm install              # 安装依赖
pnpm run build            # 各插件 build.ps1：tsdown / tsc 输出到 lib/
pnpm test                 # node --test（各插件测试集不同）
```

环境：Windows + PowerShell（`build.ps1` 依赖 pwsh/powershell）、Node.js ≥ 20、pnpm。
构建脚本需要本机存在 DSH 源码 checkout（用 `-Checkout` 参数指定），详见各插件注意事项。

仓库不提交 `node_modules/`；`lib/` 构建产物**有意**随仓库提交。

## 许可

仓库本身未附 `LICENSE` 文件；各插件的 `package.json` 声明 `license: BSD-3-Clause`。
