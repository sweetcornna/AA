# 同享 · 新应用标志

用两段圆弧表达共同的圈子，用中心等号表达公平分账。以原生蓝 `#1769DF` 和圆角线条统一当前界面；产品名称仍为「AA 记账」。

主标志已替换登录页与桌面侧栏的 AA 字母图形，并更新浏览器 favicon、Web/PWA 图标、分享图、Android/iOS 和桌面应用图标资源。

## 预览与文件

- [成品与实际页面](review-board.html)
- [四个生成探索方向](concepts/review-board.html)
- [蓝色 SVG 符号](exports/tongxiang-symbol.svg)
- [白色 SVG 符号](exports/tongxiang-symbol-white.svg)
- [应用图标 SVG](exports/tongxiang-app-icon.svg)
- [移动端登录页](screenshots/login-mobile.png)
- [桌面圈子页](screenshots/circles-desktop.png)
- [16–96px 尺寸检查](screenshots/small-sizes.png)

## 来源与生成

Creative Production 的 Logo 工作流生成了「同享、相伴、合账、围坐」四个不同方向，每个方向为一次原生 ImageGen 输出。`concepts/` 保留未改动的探索原图及提示词记录；原生结果为 1254×1254 透明 PNG，部分原图边缘有生成瑕疵，仅用于方向评估。

选用「同享」，再按 24×24 网格重绘为可生产的纯矢量几何：两段等重圆弧、两个等长横画、2.3 单位圆角描边。正式应用资源来自矢量稿，未直接使用带瑕疵的探索位图。

唯一几何源文件：`apps/app/src/assets/brand-symbol.svg`。React 直接内联这个受版本管理的静态 SVG，支持 `currentColor`。执行 `node scripts/gen-icon.mjs` 可重新导出全部资源，需要项目依赖和 Playwright Chromium。

Android 分别提供背景、透明前景和单色图层；Web manifest 使用独立的全出血 maskable 图标，符号位于安全区。Tauri 对已存在的移动项目直接写入原生资源，脚本再同步备用图标目录，避免旧资源覆盖新图标。

本次环境没有可直接调用的 Creative Production 画板接口，因此使用插件提供的共享 review renderer 输出静态审阅页；未创建替代 MCP 画板。

## 本次验证

- 类型检查通过。
- 使用仓库 CI 的公开构建校验配置，Web 生产构建通过；未部署上线。
- 现有响应式业务场景在 Chromium、Firefox、WebKit 各通过一次，覆盖 360/390/768/1280/1440px、真实测试账号、圈子数据、记账入口、弹窗和减少动画设置。
- 登录页与桌面侧栏实际渲染正常；登录页无 JavaScript 页面异常；检查了 16/24/32/48/96px 图标。
- Android `:app:processArm64DebugResources` 编译通过；人工查看生成的 iOS 图标和 Android 前景图层。
- 本次只编译 Android 资源，未重装应用或进行本轮真机启动验收。原完整业务回归记录见 [UI_REDESIGN_QA.md](../UI_REDESIGN_QA.md)。

页面截图使用独立测试账号和测试数据，场景完成后已清理。
