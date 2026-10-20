# QQAgent 网易云双人一起听

让 QQA 使用独立的网易云账号与你一起听歌，在 QQ 中选歌、讨论歌曲，并按人设决定是否发出低频邀请、回应切歌和切换播放模式。

这是 **QQAgent 原生扩展仓库**，使用 `skill.json`、`plugin.json` 和 JavaScript 入口。适用于 QQAgent 的 skills/plugins 体系。

## 版本与功能

| 模块 | 版本 | 用途 |
| --- | --- | --- |
| `netease-listen-together` | 2.5.1 | 双人房间、14 个音乐工具、随机邀请、自主播放模式 |
| `netease-song-review` | 1.4.2 | 可选；按人设回应歌曲变化、点评、收藏和搜歌分享 |
| `netease-local-adapter` | 1.0.1 | 必需；受限本机通信、动态识别 QQA 控制台、维护桥接进程 |
| `bridge` | 2.5.1 | 必需；网易云双人协议与登录会话管理 |

- 支持搜索、加入/创建双人房间、共享歌单、选歌、下一首、收藏、暂停/继续、当前状态和讨论资料。
- 主动邀请默认随机间隔 **3～6 小时**，同一机器人滚动 24 小时最多 **2 次**；北京时间 23:00～09:00 静默。未回应不追问，发送结果未知也占用次数。用户明确同意后才开房。
- 用户主动命令开房走普通工具流程，**不占用自主邀请次数**。
- 支持单曲循环、列表循环、随机循环。QQA 可自主决定切换，间隔至少 **10 分钟**，同一机器人滚动一小时最多 **3 次**；用户手动指定模式不占自主次数，并保护该模式一小时。
- 安装歌曲回应扩展后，用户切歌可触发由当前人设决定的回应；连续切歌会合并等待，允许模型保持沉默。

## 安装

需要 Node.js 22 或更高版本、带原生扩展能力的 QQAgent、已连接的 OneBot，以及 **两个不同的网易云账号**：用户账号与 QQA 专用账号。

```powershell
git clone https://github.com/beibefrancisco665-dot/netease-listen-skill.git
cd netease-listen-skill
npm run setup
npm test
```

随后按照 [安装与配置](docs/INSTALL.md) 将扩展和桥接复制到 QQA 对应目录，扫码登录 QQA 专用网易云账号，填写本机连接密钥并授权 QQ 会话。

**不要只复制一起听 skill。** 它通过 `netease.local.fetch` 调用本地适配插件，插件和桥接服务均为必需组件。QQA 的安装位置及数据目录以当前实例实际路径为准。

必需插件已随仓库提供：[netease-local-adapter 源码与说明](plugins/netease-local-adapter/README.md)。将整个插件目录放入 `<QQAgent应用目录>/plugins/`，不要放进 `skills/`。[本次上传补充说明](docs/PUSH_NOTES.md)列出了安装版与仓库版的对应关系。

## 配置与数据

[config/qqa.example.json](config/qqa.example.json) 仅展示需要合并的设置；连接密钥、QQ 会话默认留空。请在本机 QQAgent 设置中填写，保留已有配置。

- 网易云 Cookie、连接密钥、房间绑定、限频状态和二维码均在本机生成，仓库不提供登录会话。
- `.gitignore` 排除 `runtime/`、`data/`、`.env`、日志和依赖目录。发布前仍需检查实际暂存文件。
- 本地桥接仅监听 `127.0.0.1`，使用随机 Bearer 密钥，并核验当前 QQA 实例、OneBot 身份及允许的会话。
- 不需要放开 QQA 全局内网访问权限。

## 验证

`npm test` 使用模拟网易云响应和临时本机 HTTP 服务验证房间协议、权限、随机邀请、播放模式限频、适配层及工具调用；不会开真实房间或向 QQ 发消息。

如需验证实际 QQA 加载器，设置 `QQA_SOURCE` 为带 `src/` 和已安装依赖的 QQA 应用目录，再执行 `npm run test:qqa`。它复制宿主源文件到本仓库隔离目录，不读取正式账号配置，不启动音乐桥接。

本仓库整理自已安装版本；自动化测试不代替你自己的真实账号、当前网易云接口和长期后台运行验证。详见 [版本记录](CHANGELOG.md) 与 [安全说明](SECURITY.md)。

## 来源与许可

本仓库代码采用 [MIT](LICENSE) 许可；QQAgent、网易云兼容 SDK 等来源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。固定依赖 `@neteasecloudmusicapienhanced/api@4.40.1`，通过 npm 安装。
