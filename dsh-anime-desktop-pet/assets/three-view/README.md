# 三视图参考图资源目录

每个角色可选提供一张三视图参考图；**文件名固定为 `<animation-id>.png`**（也接受 `.jpg/.jpeg/.webp/.gif`），
由客户端 `core.mjs` 角色注册表的 `threeView` 字段映射，宿主半通过
`/@dsh-external/dsh-anime-desktop-pet/assets/three-view/` 前缀路由安全服务。

当前首项：

| 角色 | 动画 id | 期望文件名 | 状态 |
| --- | --- | --- | --- |
| 蓝色大肥鱼 | `blue-fat-fish-working` | `blue-fat-fish-working.png` | **待接入**（暂未收到素材，预览层显示「三视图暂未提供」占位） |

接入方式：

1. 把三视图图片按上表文件名放进本目录；
2. 无需改代码（若新增角色，在 `src/client/core.mjs` 的 `ANIMATIONS` 里声明 `threeView: 'three-view/<id>.png'`）；
3. 重建/刷新页面后，右键「设置」→ 角色行图片按钮打开预览；右键预览图可复制图片或另存为。

安全约定：前缀路由只接受本目录下的扁平图片文件名白名单扩展名，拒绝子目录与 `..` 穿越；
非图片文件不会被服务。素材缺失/加载失败时客户端显示「三视图暂未提供」占位，不会出现破图。
