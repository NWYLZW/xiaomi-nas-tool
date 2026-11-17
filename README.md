# Xiaomi NAS Tool

面向 Xiaomi 智能存储的模块化局域网工具。项目名不限定设备型号；RP05 是目前经过验证的设备，并不代表已支持其他型号。第三方社区项目，与小米无关联。
目前提供认证连接诊断和单项 Samba 账号操作；账号列表为空是正常状态。**尚不提供 SSH 开启或 root 功能。**

## 状态和适用范围

- 只读诊断：在 RP05 固件 `1.0.9.464.F24C26D24-REL` 实机验证认证及空账号读取。
- Samba 创建：**实验性**，目前仅做模拟测试，尚未在设备上创建过账号。设备 API 和返回格式可能因固件改变。
- 不包含任何攻击载荷、不自动修改系统文件、不开启 SSH，不做固件降级。不能假定其他固件适用。
- Mac 桌面客户端证书发现已测试；Windows 的默认目录为社区资料中的路径，尚未验证。

## 环境

1. 本机安装并登录 [小米智能存储桌面客户端](https://smartstorage.xiaomi.com/)，打开目标设备。
2. Python 3.9 或更新版本，且其 SSL 库须支持 Ed25519 客户端证书。macOS 系统自带的老版本 Python/LibreSSL 可能不支持，请使用较新的 Python 和 OpenSSL。
3. NAS 与电脑网络互通。请自行从客户端或路由器查看局域网地址。

本项目运行时只依赖 Python 标准库，无需上传证书或将证书复制进项目。

## 使用

在项目目录执行：

```sh
python3 -m xiaomi_nas_tool.cli --host NAS_IP diagnose
python3 -m xiaomi_nas_tool.cli --host NAS_IP ssh status
python3 -m xiaomi_nas_tool.cli --host NAS_IP samba list
```

`ssh status` 只检查端口，不需要客户端证书或 Samba 账号；端口开放也不代表 SSH 登录可用。其他命令需要认证。也可以自行将项目安装到虚拟环境后用 `xiaomi-nas-tool --host NAS_IP diagnose`。证书不在默认路径时，在子命令前提供 `--cert-dir`。每次执行只负责当前操作，不写入配置文件。

实验性的单账号创建：

```sh
python3 -m xiaomi_nas_tool.cli --host NAS_IP samba create --username ACCOUNT --path /ABSOLUTE/PATH
```

密码通过交互式终端输入，不放在命令参数或日志中。创建前检查现有账号、名字与状态；服务端分配 ID 后读回核验，不硬编码账号编号。写入超时或校验失败时不会自动重试或删除，请在官方客户端检查。**这不是服务端事务**：检查和写入之间可能有其他客户端并发操作；使用时请勿同时修改 Samba 配置。

## 隐私

工具不收集、上传或记录密码、私钥、设备标识、NAS 地址、文件名或 API 响应。设备通信只发生在使用者指定的 NAS 上，服务端证书通过客户端 CA 校验。不要将证书、账号密码、设备地址、UID、日志或私人路径加入 issue、提交或截图。`.gitignore` 只是辅助，提交前仍需检查。

## 开发与验证

```sh
python3 -m unittest discover -s tests -v
```

模块划分：`client.py` 负责认证与协议，`samba.py` 负责账号状态与创建，`cli.py` 组合命令。各操作明确区分读取、写入与校验；不会因缺失账号列表而推断为空。

## 参考资料与许可

本项目根据公开设备接口和可观察行为独立实现，未复制以下项目代码：

- [kid0114/xiaomi-nas-ssh-root-tool](https://github.com/kid0114/xiaomi-nas-ssh-root-tool)：社区 SSH 研究、设备认证与固件差异。
- [lvmaple/minas_plugin](https://github.com/lvmaple/minas_plugin)：社区设备接口、账号与清理行为研究。

这两个仓库的相关代码未发现明确的再分发许可证；如需使用其工具，请遵循原仓库许可。此项目自己的代码采用 [MIT 许可证](LICENSE)。
