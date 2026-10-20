# 2026-10-20 push 补充说明

## 本次补充

针对本机 `netease-local-adapter` 插件重新核对仓库：首次提交 `0f80be5` 已包含完整插件运行文件，仓库目录为 [`plugins/netease-local-adapter/`](../plugins/netease-local-adapter/README.md)。

本次增加插件独立说明、来源/差异清单和首页入口，明确插件属于一起听功能的必需依赖。补充内容为文档，插件继续使用仓库版 1.0.1，不改变运行代码、依赖版本、技能配置默认值及邀请/模式切换次数。

## 首次 push 的完整范围

| 组件 | 仓库位置 | 版本/要求 |
| --- | --- | --- |
| 双人一起听 Skill | `skills/netease-listen-together/` | 2.5.1，必需 |
| 歌曲回应扩展 | `skills/netease-song-review/` | 1.4.2，可选 |
| 本地通信适配插件 | `plugins/netease-local-adapter/` | 1.0.1，必需；来自安装版 1.0.0 |
| 网易云桥接 | `bridge/` | 2.5.1，必需；部署到当前 QQA 数据目录的 `netease-bridge/` |

安装时将两个 Skill 放入宿主 `skills/`、适配插件放入宿主 `plugins/`。**只复制 Skill，或只复制插件，都不能完成一起听接入**。还需要桥接依赖、专用网易云账号登录、QQA 插件信任及会话授权。完整步骤见 [INSTALL.md](INSTALL.md)。

## 安装版与仓库版

安装版插件清单仍为 1.0.0。仓库 1.0.1 保留相同的本机请求代理和 Skill 请求入口，将固定开发机 Node 路径改为可配置路径/PATH 选择，并增加 `launch.mjs`。逐文件对应关系及原文件哈希见 [SOURCE.md](../plugins/netease-local-adapter/SOURCE.md)。

本次没有对用户正在使用的安装目录进行升级或重载。仓库中的 1.0.1 和本机运行的 1.0.0 需分别识别。

## 验证与敏感信息

首次发布已完成 87 项自动化测试、隔离宿主加载/重载及 Windows/Linux × Node 22/24 四组 CI，详见 [首次运行记录](https://github.com/beibefrancisco665-dot/netease-listen-skill/actions/runs/39412680364)。这些结果对应首次代码提交，本次新增文档不宣称重新进行了真实账号联网测试。

安装版四个插件文件复核未发现写死的登录 Cookie、API Key 或连接密钥。代码读取本机设置中的凭据；运行时配置、会话与日志不在发布范围内。首次发布保留的 SDK 依赖告警仍见 [SECURITY.md](../SECURITY.md)，本次未修复或更换依赖。
