# 安装版来源与发布版差异

核对日期：2026-10-20。源为 QQAgent 已安装的 `plugins/netease-local-adapter/`，清单版本 **1.0.0**；此仓库发布版本 **1.0.1**。

首次发布提交 `0f80be5ae154593ba4ee7050a712bf5525c3c215` 已包含本插件的全部四个安装版文件及新增的启动辅助模块。本次补充文档时重新核对，没有发现遗漏的运行文件。

| 安装版文件 | 仓库对应文件 | 差异 |
| --- | --- | --- |
| `broker.mjs` | 同名 | 内容与字节哈希一致 |
| `client.mjs` | 同名 | 内容与字节哈希一致 |
| `index.js` | 同名 | 保留能力与进程维护逻辑；Node 选择改用 `launch.mjs`，日志文件名与启动失败提示通用化，统一末尾换行 |
| `plugin.json` | 同名 | 版本 1.0.1，增加空默认值的 `nodeExecutable` 设置及设置说明 |
| — | `launch.mjs` | 新增；Electron 环境默认用 PATH 中的 `node`，普通 Node 环境使用当前可执行文件，也支持显式路径 |

因此，仓库不是安装版 1.0.0 的字节镜像；它是保留通信核心的可移植发布版。本次未把代码改回含固定开发机 Node 路径的 1.0.0。

## 安装版原文件 SHA-256

这些指纹只用于核对来源，不是连接密钥。

```text
c03940e89b6bbca5a2a87182374b3566945b15fd2be095ecca8adb655e08a347  broker.mjs
801e9a91e969c42d6767c15f5dbd5428c042f28448f904bd59d7837f299268a5  client.mjs
7ee2fa5e88efb0a4ae0888d31dc0b2b2a72de07987dc0f56d76b20281222bd75  index.js
31a2bdd0c7e51501e66349bf1e3ad4a7e291e6d65e94f59d05e8669d98fef0de  plugin.json
```

复核与打包只读取原安装文件。不会将运行时数据、Cookie、连接密钥或私人配置带入本插件源码目录。
