# 网易云本机通信适配插件

`netease-local-adapter` 是一起听 Skill 的**必需插件**，当前仓库版为 **1.0.1**。它在 QQAgent 与本机网易云桥接之间提供受限通信，并按需维护桥接进程。

安装目录中的 1.0.0 已完整纳入上一版仓库整理；仓库 1.0.1 继续使用相同的 `broker.mjs`、`client.mjs`，启动入口增加可配置 Node 路径。[来源与差异](SOURCE.md)提供逐文件说明。

## 文件

| 文件 | 作用 |
| --- | --- |
| `plugin.json` | 插件清单、能力声明与设置项 |
| `index.js` | 宿主配置接入、能力提供、桥接检查及进程维护 |
| `broker.mjs` | 本机请求白名单、实例/身份/会话核验与发送限额检查 |
| `client.mjs` | 供一起听和歌曲回应 Skill 使用的请求适配入口 |
| `launch.mjs` | 选择 PATH 中的 Node 或用户配置的可执行文件 |

两个 Skill 通过 `../../plugins/netease-local-adapter/client.mjs` 引用本插件。一起听清单声明依赖 `netease.local.fetch`，因此需保留仓库中的目录层级。

## 安装与启用

1. 备份已存在的同名插件，复制本目录到 `<QQAgent应用目录>/plugins/netease-local-adapter/`。保持原目录名和全部运行文件。
2. 将 `netease-local-adapter` 追加到 QQA 的 `trustedPlugins`；设置保存在 `config.skills['netease-local-adapter']`。通过本机设置启用插件。
3. 按[完整安装说明](../../docs/INSTALL.md)准备 `<QQAgent数据目录>/netease-bridge/`，安装依赖并登录 QQA 专用网易云账号。
4. 配置一起听及可选歌曲回应 Skill 的本机桥接地址、连接密钥和允许的 QQ 会话。插件从对应 Skill 的设置读取这些值。
5. 重载扩展或重启 QQA，查看“网易云本机通信”状态。多实例使用各自的数据目录和 `console-port`，实例身份不匹配会拒绝操作。

本插件无需在自己的目录执行 `npm install`；桥接服务的依赖仍须按完整安装说明安装。

| 设置 | 默认值 | 用途 |
| --- | --- | --- |
| `enabled` | `true` | 插件内部通信开关；清单默认不自动启用模块 |
| `autoStartBridge` | `true` | 启用插件后按需维护本机桥接进程 |
| `nodeExecutable` | 空 | Electron 下使用 PATH 中的 `node`；可填 `node.exe` 完整路径，无需引号或参数 |

只复制插件不等于桥接已配置完成。缺少桥接源码、登录会话、依赖、允许会话或连接密钥时，需要完成对应步骤。

## 能力与约束

- `netease.local.fetch`：仅供 `netease-listen-together`、`netease-song-review` 使用的本机请求入口。
- `status.netease-local-adapter`：在宿主状态中显示桥接连接和当前实例控制台信息。
- 仅接受明确白名单中的回环 HTTP 地址及操作；不提供任意内网访问、控制台配置修改或程序启动接口。
- 每次操作仍检查技能状态、QQA 实例身份、OneBot 及会话权限；消息发送还受宿主权限和限额约束。
- 插件由宿主启动桥接时携带当前数据目录，并禁止自动恢复旧房间；主动邀请、切歌和模式切换继续使用各自原有限频规则。

不要将 `runtime/`、QQA 配置、网易云 Cookie、连接密钥或日志放进本目录提交。开发验证见仓库根目录的 `npm test` 和 `npm run test:qqa`。
