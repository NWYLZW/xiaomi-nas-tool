# Xiaomi NAS Tool

一个用 Node.js 编写的小米智能存储局域网工具。它目前主要帮你**检查 NAS 连接、查看 SSH 状态，以及查看或创建 Samba 文件共享账号**。这是第三方社区项目，与小米无关联。

项目面向以后支持多个型号；目前只在 **RP05** 上实测过连接诊断，不代表已支持其他型号。

## 现在可以做什么？

| 你想做什么 | 当前工具能做什么 |
| --- | --- |
| 检查电脑能否连接 NAS | 验证本机客户端证书，并检查 NAS 是否响应。 |
| 看 SSH 是否已经打开 | 检查 SSH 使用的 22 端口；端口开放也不代表已经登录成功。 |
| 检查开启 SSH 的前置条件 | 只读检查认证、文件服务身份和 Samba 账号状态；不修改设备，不会开启 SSH。 |
| 查看 Samba 账号 | 显示账号数量。没有账号也是正常状态，不影响连接诊断。 |
| 创建 Samba 账号 | 可尝试创建一个用于局域网文件共享的账号；这是实验功能，目前只做过模拟测试，**没有在真实 NAS 上验证创建**。 |

Samba 是一种局域网文件共享方式，设置后可以让电脑通过网络访问 NAS 上指定的文件夹。

## 现在还不能做什么？

**这个工具目前不能开启 SSH，也不能获取 root 权限。** SSH 是远程进入设备命令行的方式；root 是设备的最高管理权限。仅靠当前工具，还不能进入 NAS 系统安装 Docker 或其他自托管服务。

为 RP05 开启 SSH 是后续目标，但目前没有完成。特别是 `1.0.9.464` 固件，还需要验证社区方案、临时共享的创建及失败清理流程。请勿将本项目的连接诊断误认为已经完成 SSH 开启。

## 已验证范围

- RP05，固件 `1.0.9.464.F24C26D24-REL`：验证过客户端证书认证、SSH 端口检查和空 Samba 账号列表读取。
- Mac：验证过从官方桌面客户端的默认位置查找证书；Windows 默认路径来自社区资料，尚未实机验证。
- 其他型号和固件、Samba 创建功能：尚未实机验证。

## 准备工作

1. 安装 Node.js 22 或更新版本。项目运行只使用 Node.js 内置模块，无需安装第三方依赖。
2. 检查 SSH 端口以外的功能时，先安装并登录[小米智能存储桌面客户端](https://smartstorage.xiaomi.com/)，进入目标 NAS。
3. 让电脑能访问 NAS 的局域网地址；可从小米客户端或路由器查看该地址。

不需要把客户端证书、私钥或密码复制到本项目中。

## 如何使用

在下载的项目目录中运行，把 `NAS_IP` 换成自己的 NAS 局域网地址：

```sh
# 检查客户端认证、SSH 端口和 Samba 账号数量
node bin/xiaomi-nas-tool.js --host NAS_IP diagnose

# 只检查 SSH 端口；不需要登录小米客户端，也不需要 Samba 账号
node bin/xiaomi-nas-tool.js --host NAS_IP ssh status

# 只读检查 SSH 方案的前置条件；不代表该固件的开启方法已验证
node bin/xiaomi-nas-tool.js --host NAS_IP ssh preflight

# 查看 Samba 账号数量
node bin/xiaomi-nas-tool.js --host NAS_IP samba list
```

也可在项目目录执行 `npm install -g .`，再使用 `xiaomi-nas-tool --host NAS_IP diagnose`。如客户端证书不在默认位置，可在命令中指定 `--cert-dir DIR`。

### 创建 Samba 账号（实验性）

这个命令会**修改 NAS 的共享账号配置**，只在你确实需要局域网文件共享时使用。`ACCOUNT` 是你想创建的账号名，路径是 NAS 上需要共享的绝对路径：

```sh
node bin/xiaomi-nas-tool.js --host NAS_IP samba create --username ACCOUNT --path /ABSOLUTE/PATH
```

密码在交互式终端中输入两次，不会显示或写入命令参数。工具会检查已有账号，由设备分配编号，并在写入后尝试读回核验。如果写入超时或核验失败，**不要直接重试**，先在官方客户端检查是否已创建。设备 API 不提供事务保证：请勿在操作期间从其他客户端同时更改 Samba 配置。

## 隐私

工具不收集或上传密码、私钥、设备标识、NAS 地址、文件名或 API 响应，不主动写入日志或配置文件。它只连接使用者指定的 NAS，并通过客户端的 CA 校验服务器身份。不要将证书、账号密码、设备地址、UID、日志或私人路径放进公开 issue、提交或截图。`.gitignore` 只是辅助，提交前仍需检查。

## 开发与验证

```sh
npm test
```

`src/client.js` 负责认证与协议，`src/samba.js` 负责账号操作，`src/ssh-preflight.js` 负责只读前置检查，`src/cli.js` 负责组合命令。读取、写入与验证分开实现；缺失或不符合预期的账号列表视为未知，不会当作空列表。`ssh preflight` 输出的空闲位置仅是根据社区对 1.0.9.462 的观察做出的预测，后续写入时必须核对设备实际返回的信息。

## 参考资料与许可

本项目根据公开设备接口和可观察行为独立实现，未复制以下项目代码：

- [kid0114/xiaomi-nas-ssh-root-tool](https://github.com/kid0114/xiaomi-nas-ssh-root-tool)：社区 SSH 研究、设备认证与固件差异。
- [lvmaple/minas_plugin](https://github.com/lvmaple/minas_plugin)：社区设备接口、账号与清理行为研究。

这两个仓库的相关代码未发现明确的再分发许可证；如需使用其工具，请遵循原仓库许可。此项目代码采用 [MIT 许可证](LICENSE)。
