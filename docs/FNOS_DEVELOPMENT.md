# 家藏 fnOS 开发与发布基线

本文根据飞牛应用开发者平台文档整理，并结合家藏的 SQLite、图片、OCR 和 AI 数据特点落地。最后核对日期：2026-07-20。

## 访问模型

家藏是常驻 Node.js 服务，使用统一网关：

```text
gatewayPrefix=/app/fnos-app-family-stock
gatewaySocket=app.sock
os_min_version=1.1.3100
```

服务监听 `${TRIM_APPDEST}/app.sock`，不声明 `service_port`。统一网关支持 NAS 登录态、普通 HTTP、API 和 WebSocket，避免 CGI 每次请求启动进程的性能和能力限制。

网关转发：

- `X-Trim-Userid`
- `X-Trim-Username`
- `X-Trim-Isadmin`

这些 Header 只在服务通过 fnOS Unix Socket 运行时作为可信登录上下文。网关不替代业务鉴权，后续成员体系必须验证当前用户是否属于目标家庭、是否有权读取图片和修改库存。

## 目录和数据

应用文件：

```text
TRIM_APPDEST/server
TRIM_APPDEST/ocr-worker
TRIM_APPDEST/app.sock
```

持久化数据：

```text
TRIM_PKGVAR/data/db
TRIM_PKGVAR/data/images
TRIM_PKGVAR/data/models
TRIM_PKGVAR/data/backups
TRIM_PKGVAR/data/ocr-venv
TRIM_PKGVAR/data/secrets
TRIM_PKGVAR/log
```

SQLite 数据库和 `secrets/ai-settings.key` 必须一起备份和迁移，否则已加密的 DeepSeek API Key 无法解密。

家藏当前不需要用户在文件管理器中直接操作应用数据，因此 `config/resource` 保持 `{}`。如果以后增加用户可见导入/导出目录，再声明 `data-share`，不应直接暴露数据库、AI 密钥、内部日志或原始任务文件。

## 权限

应用使用：

```json
{
  "defaults": {
    "run-as": "package"
  },
  "username": "fnos-app-family-stock",
  "groupname": "fnos-app-family-stock"
}
```

长期运行服务不使用 root。只有确需硬件用户组时才添加最小范围的 `join-groups`。

## 生命周期

`cmd/main`：

- `start`：幂等启动，创建持久化目录，启动后检查 PID 和 Socket。
- `stop`：先发送 `TERM`，10 秒后仍未退出再发送 `KILL`。
- `status`：运行返回 `0`，未运行返回 `3`。

运行时使用：

- `TRIM_APPDEST` 定位 Nitro 和 OCR Worker。
- `TRIM_PKGVAR` 保存 PID、日志、数据库、图片、模型和密钥。
- `TRIM_TEMP_LOGFILE` 输出用户可见错误。
- `/var/apps/nodejs_v22/target/bin` 提供 Node.js 运行时。

生命周期脚本应可重复执行，不得通过硬编码应用安装卷定位数据。

## Manifest

关键字段：

```text
source=thirdparty
platform=all
install_dep_apps=nodejs_v22
os_min_version=1.1.3100
ctl_stop=true
disable_authorization_path=true
```

`platform=all` 仅在包内没有架构相关原生二进制时成立。OCR 虚拟环境在目标设备上安装，因此发布前必须分别验证计划支持的 x86/ARM 环境；如果未来随包携带原生模型运行库，需要拆分架构包或调整 `platform`。

## 图标

- `ICON.PNG`：64 x 64
- `ICON_256.PNG`：256 x 256
- 入口图标：`app/ui/images/icon_{0}.png`

发布前确认 PNG 使用 sRGB、单文件不超过 1024 KB，并在 64px 下保持清晰。

## 本地验证

```bash
npm ci
npm test
APP_PORT=3340 WEB_PORT=3341 npm run dev
npm run build
PORT=3340 npm start
```

模拟统一网关：

```bash
FNOS_SOCKET_PATH=/tmp/fnos-family-stock.sock npm start
curl --unix-socket /tmp/fnos-family-stock.sock \
  http://localhost/app/fnos-app-family-stock/api/health
```

## 打包与设备测试

```bash
npm run download:fnpack
npm run pack:fpk
```

设备侧：

```bash
appcenter-cli install-fpk fnos-app-family-stock.fpk
appcenter-cli start fnos-app-family-stock
appcenter-cli stop fnos-app-family-stock
```

发布前必须验证：

- [ ] 干净设备可安装并自动安装 `nodejs_v22`
- [ ] 桌面入口在 HTTP/HTTPS NAS 访问方式下均可打开
- [ ] 启动、停止、状态和异常恢复正确
- [ ] SQLite WAL、备份、图片读取和缩略图正常
- [ ] OCR 缺失时进入 `waiting_runtime`，安装环境后可恢复
- [ ] OpenVINO 在目标 CPU 上没有 `Illegal instruction`
- [ ] DeepSeek 不可用时规则候选仍可人工确认
- [ ] API Key 不出现在响应、日志和安装包中
- [ ] 普通用户不能访问其他家庭的数据或图片
- [ ] 升级保留数据库、图片、模型和密钥
- [ ] 卸载保留/删除严格遵循用户选择
- [ ] manifest、图标、真实截图和更新说明准确

## 官方来源

- [飞牛应用开发者平台](https://developer.fnnas.com/docs/guide/)
- [应用框架](https://developer.fnnas.com/docs/core-concepts/framework/)
- [Manifest](https://developer.fnnas.com/docs/core-concepts/manifest/)
- [环境变量](https://developer.fnnas.com/docs/core-concepts/environment-variables/)
- [应用权限](https://developer.fnnas.com/docs/core-concepts/privilege/)
- [应用资源](https://developer.fnnas.com/docs/core-concepts/resource/)
- [统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration/)
- [用户向导](https://developer.fnnas.com/docs/core-concepts/wizard/)
- [Native 应用案例](https://developer.fnnas.com/docs/examples/native/)
- [fnpack](https://developer.fnnas.com/docs/cli/fnpack/)
- [appcenter-cli](https://developer.fnnas.com/docs/cli/appcentercli/)
