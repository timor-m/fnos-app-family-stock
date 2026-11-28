# 家藏 Agent/MCP 接入

## 兼容方式

本版提供标准 MCP Streamable HTTP、工具发现与调用，使用官方 `@modelcontextprotocol/sdk` 1.32.2；当前 SDK 协议版本为 2025-11-25，向后兼容范围以 SDK 协商结果为准。

授权方式是用户在家藏生成、客户端手动配置的 **Bearer Token**。这不是 OAuth 浏览器自动授权：本版没有 OAuth 客户端注册、授权码、自动刷新或 OAuth metadata。需要 OAuth 自动登录的客户端暂不能直接使用，不应把手动 Token 填成 OAuth 配置。

## 配置

1. 在“我的 → Agent 接入”由设备管理员选择独立入口范围和端口（默认 3335），填入客户端实际可访问的 MCP 地址。仅同机使用 `http://127.0.0.1:3335/mcp`；局域网使用 `http://NAS局域网IP:3335/mcp`，并选择“局域网”。默认停用，不会自动开放端口。
   飞牛统一网关要求网页登录，不能直接把 `/app/fnos-app-family-stock/mcp` 给外部 Agent。独立入口仅开放 MCP，不提供页面、管理或确认 API。局域网 HTTP 仅用于可信内网；跨公网需自行配置 HTTPS 反向代理，切勿直接公开明文 Token。
   “家藏确认页面地址”仍填飞牛登录入口，例如 `https://你的设备域名/app/fnos-app-family-stock`。保存并启用后页面显示实际监听地址；端口占用会报错并保留原设置。
2. 新增授权：输入连接名称，选择家庭和 7/30/90 天有效期。默认只允许查库存，可额外允许查询流水、提出库存变更。
3. 创建后立即保存授权，Token 只展示一次。复制到你选择的 Agent 客户端，禁止发到群聊或提交到代码库。
4. 在支持自定义 Header 的 Streamable HTTP 客户端配置接入 URL，并设置 `Authorization: Bearer <Token>`。不同客户端的 JSON 格式可能不同，以该客户端配置界面为准。
5. 撤销立即生效，到期后需新建授权。凭据丢失或泄露时撤销旧授权再创建；家藏不保存可回读的 Token 明文。

官方 SDK 客户端示例：

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-family-agent', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.FAMILY_STOCK_MCP_URL), {
  requestInit: { headers: { Authorization: `Bearer ${process.env.FAMILY_STOCK_MCP_TOKEN}` } }
}));
console.log(await client.listTools());
console.log(await client.callTool({ name: 'search_inventory', arguments: { query: '牛奶' } }));
await client.close();
```

Token 绑定具体用户和家庭。更换聊天渠道不会改变 Token 的权限；如果把一份 Token 配到多人共用的机器人，能使用该机器人的人可能间接访问对应家庭，应在 Agent 侧限制消息发送者。家藏不能通过 MCP 凭空识别微信/飞书消息的实际发送者。

## 工具与写入

- 查询：get_context、search_inventory、get_inventory_item、list_expiring_inventory、get_inventory_history。
- 提出变更：prepare_stock_in、prepare_stock_operation（consume/discard/transfer）。
- 查询处理结果：get_operation。

入库需明确品类、地点、商品名、数量和单位。消耗/丢弃/移动需先查批次 ID 和 version；丢弃要填写原因。多个同名批次需由用户选择，不能猜测。工具只允许当前授权家庭，不接收任意 familyId/userId。

prepare 返回待确认操作与 confirmationUrl，**不直接修改库存**。用户通过飞牛登录家藏，检查具体物品、数量、地点和前后变化后确认。Agent 没有批准接口，Token 不能代替浏览器身份执行确认。

操作有效期 15 分钟。库存版本改变时返回冲突，重新查询、提出并确认。同一笔操作在重试时复用 requestId；相同 requestId 的参数不能变更。超时先查 get_operation，避免用新 requestId 重复创建。

## 排查

- 401：Token 缺失/错误、授权过期或撤销、MCP 停用、用户已不属于该家庭。
- 403：Origin 不允许、权限范围不足，或拿 Agent Token 调用管理/确认接口。
- 工具错误：查看 isError 和中文原因；scope 不够不会通过直接拼工具名绕过。
- 云端 Agent 需要自己能连到设备地址；局域网地址不能自动从外网访问。
- “调用记录”独立页面支持连接名称搜索、状态/操作筛选和每页 20 条服务端分页；显示家藏侧工具审计，不代表外部 Agent 的模型 Token 消耗。

## 实例测试

运行 `npm run test:mcp`，会构建应用并在随机本机端口、独立临时数据库中启动真实服务，使用官方 MCP 客户端完成连接和全部工具调用。

覆盖：Token 摘要存储、工具参数、只读范围、家庭隔离、入库/消耗/移动/丢弃、用户确认、幂等、版本冲突、事务故障回滚、拒绝/过期/撤销、用户离开家庭、Origin、管理接口隔离和全局关闭。测试结束销毁临时数据，不使用开发库或飞牛现有库存。另用冻结的 v5 数据库执行真实生产模式升级，验证 v6 迁移、原家庭/地点/库存/流水保留、完整性/外键检查以及迁移前 0600 备份。

生产模式还会通过 Unix Socket 管理入口配置真实 TCP MCP 监听，验证官方 SDK 连接、同机/局域网切换、端口占用回滚、确认地址分离、私有路由隔离及停用关闭端口。

1.0.6 飞牛实机已确认独立端口启停、授权创建/撤销及独立日志页；当前执行电脑无法直连 NAS 局域网，外部 Agent 的实机调用仍需在可达该局域网的环境验证。测试后入口已关闭、临时 Token 已撤销。


## 流水时间约定

get_inventory_history 的 occurredAt 是带 Z 的 ISO 8601 UTC 时间，例如 2026-11-28T12:37:06.000Z；响应 timeZone 为 Asia/Shanghai，展示时应转换成北京时间 2026-11-28 20:37:06。无法解析的历史时间返回 null，不能据此猜测时间。格式转换只发生在查询结果，数据库原值保留。


## 本地开发与独立端口

本地开发版与飞牛使用相同的独立 MCP 监听和配置。打开本地“我的 → Agent 接入”，选择“仅本机”、默认端口 3335，点击“使用同机地址”填入 http://127.0.0.1:3335/mcp，启用后保存。确认页面地址仍为 http://127.0.0.1:3334/app/fnos-app-family-stock。配置及新增授权分别保存；Token 在创建时仅展示一次。

独立端口随后端进程启动恢复，停用后关闭；开发热重载会释放旧监听并恢复已启用配置。首次添加启动插件后，已运行的开发服务需要重启一次。MCP 端口仅提供 /mcp，不提供管理页面或确认接口。

本机 Codex 直接接入可用 Streamable HTTP URL 加 Bearer Token 环境变量。复现独立测试库验收：先 npm run build，再运行 node scripts/test-mcp-listener.mjs --local --codex。此命令临时运行 Codex，不改其全局配置、不使用现有库存；macOS 登录凭据使用系统钥匙串时，设置 CODEX_TEST_CREDENTIALS_STORE=keyring。可用 CODEX_BIN 指定 Codex 可执行文件路径。
