# 安装与配置

## 1. 确认宿主目录

QQAgent 的应用目录应含 `src/`、`skills/`、`plugins/`，桌面版通常在安装目录的 `resources/app/`。数据目录从当前实例控制台确认，内含 `config.json` 和运行时生成的 `console-port`。多实例必须分别设置。

当前打包来源是 QQAgent 0.4.8.5。其他版本需具备 `api.capability`、`isSkillActive`、原生扩展加载器、同类控制台接口及 OneBot 上下文；未逐版验证兼容性。

关闭 QQA 后，将已有同名扩展和桥接源文件备份到本机备份目录。**保留既有 `runtime/`、邀请码/模式计数状态和 QQA 配置**，更新代码不能通过清除状态重置限频。

## 2. 复制文件

按下列对应关系复制；`<应用目录>` 和 `<数据目录>` 均需替换为本机真实目录：

| 仓库内路径 | 目标 |
| --- | --- |
| `skills/netease-listen-together/` | `<应用目录>/skills/netease-listen-together/` |
| `skills/netease-song-review/`（可选） | `<应用目录>/skills/netease-song-review/` |
| `plugins/netease-local-adapter/` | `<应用目录>/plugins/netease-local-adapter/` |
| `bridge/src/`、`bridge/scripts/`、`bridge/package.json`、`bridge/package-lock.json` | `<数据目录>/netease-bridge/` 下的相同层级 |

保留 skills/plugins 两层目录结构，入口使用相对路径依赖适配插件和 QQA 的 `src/llm.js`。桥接不依赖仓库内的测试目录。

在 **目标桥接目录** 安装依赖：

```powershell
cd '<数据目录>/netease-bridge'
npm ci --ignore-scripts
```

仓库根目录的 `npm run setup` 仅用于开发测试；它不会替你安装到正式 QQA 数据目录。

## 3. 登录专用网易云账号

在目标桥接目录执行：

```powershell
npm run login
```

终端会显示二维码图片路径。打开图片，用 **QQA 专用的第二个网易云账号** 扫码并确认。登录会话和二维码仅保存在桥接的 `runtime/`。

连接配置在 `runtime/1014_连接配置_v1.json` 自动生成。只在本机查看 `bridgeToken`，随后填入一起听及歌曲回应扩展的连接密钥设置；不要发送到 QQ 或提交 Git。

## 4. 授权并启用

对照 `config/qqa.example.json`，把所需模块 ID **追加**到当前 QQA 的 `trustedPlugins`，保留其他可信模块；所用模块设置保存在 `config.skills`，包括本地适配插件。不要用示例配置覆盖整个 `config.json`。

在 QQAgent 扩展设置中完成：

1. 一起听：填写 `bridgeUrl`、本机 `bridgeToken`、允许的会话。
2. 歌曲回应（如使用）：填写同一桥接地址、密钥及对应允许会话。
3. 本地适配：启用模块和“随 QQA 维护本地音乐桥接”。
4. 确认会话还在 QQA 全局允许名单中，OneBot 已连接，所需媒体/消息工具已开启。
5. 再启用一起听及可选歌曲回应扩展，重启或按宿主提供的扩展重载方式加载。

私聊填写 `private:发起人的QQ号`，例如 `private:123456789`；不能填写机器人自己的 QQ。多个会话用逗号或空格分隔，清空并保存会撤销权限。群聊的主动邀请不在本版本范围内。

Electron 桌面版默认从 PATH 寻找 `node`；若 QQA 找不到它，在适配插件的“Node 可执行文件”中填完整 `node.exe` 路径。路径无需额外引号，也不支持附加命令参数。

## 5. 检查与使用

适配插件每分钟检查桥接，启动失败至少等待两分钟再试。桥接状态可在扩展状态中查看。确认登录文件、依赖、Node 路径、端口与连接密钥一致；修改后的诊断日志保存在 `<数据目录>/netease-bridge/logs/`，不要公开完整日志。

可以在 QQ 中明确要求：“创建一起听房间”“加入这个一起听邀请”“下一首”“改成随机循环”。只有工具回读确认成功后，QQA 才应报告成功。

需要真实音频播放的用户仍使用网易云客户端。本地桥接读取歌名、歌词及播放状态，不播放声音，也不具备直接听辨音色的能力。

关闭一起听/适配插件、撤销会话授权或暂停 QQA 时，后续操作应停止。为避免重启触发意外入房，适配插件启动桥接时不自动恢复旧房间；用户按需明确发起加入或创建。

若自行从终端运行桥接，须先在该进程环境设置 `QQA_HOST_DATA_DIR` 为当前 QQA 绝对数据目录，保持同实例控制台运行。推荐由适配插件维护，避免重复启动占用端口。
