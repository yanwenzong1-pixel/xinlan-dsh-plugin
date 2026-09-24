# DSH-plugin

DSH（DeepSeek Harness）外部插件集合。每个插件是独立的 npm 包，通过 `cordis.patch.yml`
接入 DSH 宿主，构建产物（`lib/`）已随仓库提交，clone 后可直接加载。

## 插件

| 目录 | 包名 | 作用 |
| --- | --- | --- |
| `dsh-quick-append/` | `@dsh-external/dsh-quick-append` | 输入框「快速追加」按钮 + 可编辑预存文案/预存命令 |
| `dsh-dialogue-alert-message/` | `@dsh-external/dsh-dialogue-alert-message` | 对话执行状态监控与完成/异常声音报警，附 DeepSeek 用量显示 |
| `dsh-ptc-task/` | `@dsh-external/dsh-ptc-task` | PTC 作用域子代理任务派发 |

各插件的功能细节、配置项与变更记录见其目录下的 `README.md`。

## 仓库结构

```
dsh-quick-append/            插件：源码 src/、构建产物 lib/、测试 test/、接入 cordis.patch.yml
dsh-dialogue-alert-message/  同上
dsh-ptc-task/                同上
docs/                        设计与迭代记录（Markdown、界面截图）
```

## 安装使用

1. 把插件目录拷贝到 DSH 的插件目录（或在工作区内直接引用）。
2. 按插件的 `cordis.patch.yml` 把插件挂到宿主配置上。
3. 重新加载插件；客户端插件改动需刷新页面。

## 构建与测试

```bash
cd dsh-<plugin>
pnpm install          # 安装依赖
pnpm run build        # tsdown 打包，输出到 lib/
node --test           # 运行测试
```

环境：Node.js + pnpm；仓库不提交 `node_modules/`，构建产物 `lib/` 已提交。

## 许可

仅供个人使用的私有仓库，未附开源许可证。
