# 安全说明

连接密钥、网易云 Cookie、QQA 模型密钥、控制台令牌、OneBot 凭据和用户会话均属于本机私有配置。请勿放入 Issue、PR、截图或提交记录。

仓库中的 `test-only`、`fixture-only` 等值仅为测试夹具，不能用于正式连接。示例配置的密钥为空，运行时自动生成独立的本机连接密钥。

提交前检查 `git diff --cached` 与 `git ls-files`。`.gitignore` 不能阻止已跟踪文件或强制添加的内容泄漏。若凭据已经公开，请先撤销或轮换，再处理历史。

报告问题时仅提供脱敏后的错误、版本和复现步骤。涉及凭据的问题请使用仓库支持的私密报告渠道；若没有私密渠道，请勿在公开 Issue 粘贴敏感内容。

## 固定依赖的已知问题

2026-10-20 对此锁文件执行 `npm audit`，报告 **5 个 high 级别受影响依赖节点**（包含传递依赖链），没有自动修复方案：

| 节点 | 上游问题 |
| --- | --- |
| `node-forge` | [RSA 签名验证问题 GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |
| `basic-ftp` | [目录列表解析的 CPU 拒绝服务问题 GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r) |
| `get-uri`、`pac-proxy-agent`、`@neteasecloudmusicapienhanced/api` | 因包含上述依赖而被标记 |

本次整理保留已安装实现依赖的 SDK 4.40.1；工作线程依赖其具体源码结构，不能直接用 `npm audit fix --force` 替换后声称兼容。此记录不是可利用性评估，也不表示已修复这些漏洞。后续升级需单独验证登录、双人协议及工作线程兼容性。
