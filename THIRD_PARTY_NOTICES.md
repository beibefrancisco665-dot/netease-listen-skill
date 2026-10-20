# 来源与第三方许可

## QQAgent

- 项目：<https://github.com/K0nd1us/QQ-agent>
- 当前安装宿主版本：0.4.8.5。
- Copyright (c) 2026 Kondius；MIT 许可全文保留于 `licenses/QQAgent-MIT.txt`。
- 本扩展使用其原生扩展接口、配置及模型调用能力。仓库不分发宿主源代码或其账号配置；宿主加载测试仅复制本机指定的源文件到本机隔离目录。

## NetEaseCloudMusicApi Enhanced

- 项目：<https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced>
- npm：`@neteasecloudmusicapienhanced/api`，固定版本 4.40.1。
- 包内 MIT 许可全文保留于 `licenses/NetEaseCloudMusicApi-MIT.txt`（Copyright (c) 2013-2022 Binaryify）。各传递依赖遵循自身许可证。
- `bridge/src/sdk-worker.mjs` 在独立工作线程内针对固定版 `util/request.js` 做内存适配：保留服务端 NMTID，先尝试服务端签发值，再使用格式兼容的兜底值；不修改安装的 npm 源文件。选歌预检明确使用 eapi。

## 双人协议参考

- 官方分享链接及接口路径：`st.music.163.com/listen-together/share/` 与 `/api/listen/together/…`。
- 公开讨论：<https://github.com/Binaryify/NeteaseCloudMusicApi/issues/1676>。
- SDK 示例：<https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/main/public/listen_together_host.html>。

本仓库仅包含双人一起听实现及必要的兼容逻辑，不分发网易云客户端、音乐文件、完整歌词、账号 Cookie 或 Music Party 的桌面端/通知/聊天界面代码。网易云相关名称与服务属于各自权利人，本项目不是官方产品。
