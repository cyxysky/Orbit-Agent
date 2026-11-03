# Orbit 全界面布局原型

先读 [工作交接文档](../../FRONTEND_REDESIGN_HANDOFF.md)。用户选定的风格参考为 [Global Settlement](https://ui.oiloil.org/works/global-settlement/)，布局 A/B/C 尚未最终选定。

## 打开

仓库根目录运行 `node docs/design/global-settlement/serve.mjs`，打开 http://127.0.0.1:4173/ 。支持 `--port 4174`；这是静态文档服务，不启动项目 dev/build。

- `index.html`：完整原型，顶部切换三套布局、21 个页面、34 类浮层。
- `comparison.html`：三版并排对比，使用相对 URL，可随静态服务端口和目录变化。
- `orbit-layouts.html`：离线单文件，直接在浏览器打开即可。
- `coverage.json`：页面与浮层家族清单、43 个生产源码入口映射。
- `screenshots/`：代表性画面，便于无法启动浏览器的接手者理解方向。

## 修改

编辑拆分的 CSS/JS；`shared.js`、`shell.js` 是通用部分，`settings.*`、`workspaces.*`、`overlays.*` 按功能分工，`refinements.css` 含截图后的布局调整。不要直接改生成的离线文件。

修改后运行 `node docs/design/global-settlement/package.mjs` 同步 `orbit-layouts.html`。该脚本只拼接原型静态资源。

所有数据为示例。页面导航、选择、折叠及弹窗用于比较结构；保存、执行、删除、授权和下载不会写入业务系统。生产 `src/` 尚未应用本轮视觉。

## 第三方来源

`comparison.html` 的对比外壳来自 Oil UI v0.31.0 的生成器模板，内嵌其标识、Alpine.js 与 Instrument Serif 字体。发布时将本机绝对 URL 改为同目录相对 URL，原型画面为本项目编写。相关许可保留在 `licenses/`：Oil UI 与 Alpine 使用 MIT，Instrument Serif 使用 SIL OFL。没有打包下载的完整 Skill、项目真实数据或密钥。
