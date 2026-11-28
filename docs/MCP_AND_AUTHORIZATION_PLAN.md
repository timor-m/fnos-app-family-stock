# 家藏 MCP 能力与授权方案

状态：按后续用户目标实施中。日期：2026-11-28。

实施范围调整：用户明确要求“授权 token 配置 → 常用功能 → 实例测试 → 安装飞牛”。本轮先交付标准 MCP Streamable HTTP + 手动 Bearer Token 管理；下文 OAuth 自动授权是后续扩展规划，不作为本轮已实现功能。具体当前用法与兼容范围以 [MCP_USAGE.md](MCP_USAGE.md) 为准。
需求来源：https://github.com/timor-m/fnos-app-family-stock/issues/1

## 1. 决策与第一版边界

目标：已有 Agent 可在授权家庭范围内查库存、查临期、提出入库或库存变更，用户确认后由家藏执行。微信、飞书是 Agent 的消息渠道，不属于 MCP 本身。

- 家藏提供一个 Streamable HTTP MCP 入口，复用现有业务服务和家庭权限，不内置 Agent 编排、聊天机器人或模型选择。
- 第一版支持查询、文字入库、消耗、丢弃、移动与操作结果查询。正式库存写入默认必须由家藏页面确认。
- 第一版不支持 Agent 修改家庭成员、应用配置、模型密钥、授权凭据、删除库存历史或任意 SQL/HTTP 调用；盘点调整、图片上传、OCR 任务调用后续单独扩展。
- 授权默认只读。写入授权表示允许提出操作，不能绕过具体操作确认。
- 一个授权只绑定一个用户、一个家庭、一个客户端。另一个家庭建立另一份授权，避免模型猜测当前家庭。
- 浏览器登录会话只用于管理与同意授权，绝不作为外部 MCP 的凭据。MCP 请求不得回退 local-owner。
- 当前交付使用按家庭和 scope 隔离的 7/30/90 天 Bearer Token，默认只读、仅展示一次、只存摘要、可立即撤销。OAuth 自动授权后续扩展；没有自定义 Header 能力的客户端暂不承诺兼容。

## 2. 系统路径与现有代码复用

消息渠道 → 外部 Agent/MCP 客户端 → 家藏 MCP 传输层 → 凭据与 scope 校验 → 工具参数校验 → 家庭业务服务 → SQLite/库存流水。

用户在家藏中完成授权与操作确认，Agent 通过查询结果获知状态。消息渠道账号不自动成为家藏账号；同一群里共享 Agent 凭据会共享该授权能力，接入页必须明确告知。家庭成员分别使用自己的授权。

现有实现可直接复用：

| 代码 | 用途 | 接入注意 |
| --- | --- | --- |
| utils/access-control.ts | 家庭成员关系与角色 | 每次调用实时检查，不能只在授权时检查 |
| services/dashboard.service.ts:getDashboard | 搜索与库存概览 | 不能原样暴露整个 dashboard，按工具裁剪，临期过滤需在数据库分页前完成 |
| services/catalog.service.ts | 家庭地点、收纳处、品类 | 只返回当前授权家庭；成员管理不暴露 |
| services/inventory.service.ts:createManualStockIn | 文字入库 | 继续使用原解析、校验、事务和流水 |
| services/inventory.service.ts:applyStockOperation | 消耗/丢弃/移动 | 保留库存检查，增加版本冲突保护和原子幂等执行边界 |
| services/inventory.service.ts:getInventoryHistory | 历史查询 | 增加有界分页与来源信息，不返回无限列表 |

外部认证单独解析成与 RequestUser 兼容的用户对象，但 isGatewayAdmin=false；不能将模型传入的 userId、角色、x-trim-* 作为身份。现有浏览器路由暂不改成通用开放 API。

## 3. 第一版工具契约

所有工具入参使用严格 JSON Schema，拒绝未知字段。身份与家庭取自凭据，不提供可任意指定的 familyId。分页默认 20、最大 50，游标需绑定查询条件与家庭。时间返回 ISO 8601、时区 Asia/Shanghai；日期字段区分购入/生产/到期日，不由服务端随意补猜。

| 工具 | scope | 入参与行为 |
| --- | --- | --- |
| get_context | inventory:read | 返回家庭名称、当前用户可用操作、地点/收纳处、品类字段、服务器时间与时区；地点多时分页 |
| search_inventory | inventory:read | query、locationId、storagePlaceId、expiryBefore、expiryAfter、lowStock、cursor、limit；返回批次 ID、商品名称、数量单位、地点、到期日、版本 |
| get_inventory_item | inventory:read | batchId；返回该批次详情与版本，跨家庭按不存在处理 |
| list_expiring_inventory | inventory:read | withinDays（1–365，默认 30）、includeExpired、cursor、limit；返回明确日期与已过期标记，默认排除无库存批次 |
| get_inventory_history | history:read | batchId 可选、时间范围、cursor、limit；返回库存流水，默认最近 30 天，不返回配置和凭据 |
| prepare_stock_in | inventory:propose | requestId、品类、商品名称、数量、单位、地点/收纳处及品类字段；完整校验后创建待确认操作，不正式入库 |
| prepare_stock_operation | inventory:propose | requestId、batchId、expectedVersion、operationType=consume/discard/transfer、数量与必要原因/目标地点；创建待确认操作，不扣库存 |
| get_operation | inventory:propose | operationId；仅查询本授权操作，返回 pending/confirmed/executing/completed/rejected/expired/conflict/failed 和执行结果 |

不暴露 commit/approve 工具。prepare 的返回统一包含 operationId、结构化变更摘要、expiresAt、confirmationUrl 和 status；get_operation 不阻塞轮询，不自动重复提出操作。

查询返回 structuredContent 和简短文本，标明稳定 ID、数量、单位、日期，不让 Agent 凭自然语言拼接下一步对象。工具描述与注解标明读写性质；注解仅用于客户端提示，服务端权限仍强制执行。备注、OCR、商品名称等外部文本一律作为数据，不能成为工具指令。

工具错误用稳定业务码：VALIDATION_FAILED、AMBIGUOUS_ITEM、MISSING_FIELDS、INSUFFICIENT_SCOPE、NOT_FOUND、STALE_VERSION、IDEMPOTENCY_CONFLICT、OPERATION_EXPIRED、RATE_LIMITED。认证错误使用 HTTP 401 与标准 challenge；权限不足 403；业务工具失败使用协议支持的错误结果，不把内部 SQL/堆栈返回 Agent。

## 4. 写入确认与幂等

例：“喝掉一盒牛奶”。Agent 先查候选批次；有多批次时让用户选。确定 batchId、数量和单位后 prepare，返回家藏确认链接；用户打开后看到“厨房 / 某品牌牛奶 / 此批次剩余 6 盒 → 5 盒”，确认后执行；Agent 调用 get_operation 取得流水 ID 和最新数量。

- prepare 可以存储待确认数据，但不能影响正式库存；缺地点、单位、批次等必要字段时返回缺失字段/候选，不猜测并执行。
- 确认链接只携带不透明 operationId，不携带 access token、刷新 token、密钥或可直接提交的确认凭据。知道链接不代表拥有权限。
- 确认页必须登录家藏；确认人必须是授权对应用户，仍为家庭成员，且授权、权限及操作未过期/撤销。第一版不允许其他家庭管理员代确认。
- 页面明确显示“由某 Agent 提出”、家庭、商品/批次、数量单位、前后变化、地点与日期。丢弃与移动分别清楚标注原因和目标。
- 用户只能确认/拒绝；修改内容回业务编辑器或重新 prepare，不把已确认参数替换成另一份请求。
- 默认待确认时长 15 分钟；过期重新 prepare。页面打开、按确认时都重新鉴权与校验，不信任旧页面快照。
- expectedVersion 使用数据库维护的单调批次版本，不能仅用秒级 updated_at。prepare 记录版本与规范化参数摘要；确认时版本不同返回 conflict，重新展示变更并重新确认，不能静默重算后扣减。入库涉及旧商品匹配时也绑定确定的对象。
- requestId 对每次业务意图必填，在 grantId + toolName 范围唯一；同 ID 同参数返回原操作/结果，同 ID 不同参数返回 IDEMPOTENCY_CONFLICT。网络重试复用原 requestId，语义上另一笔操作用新 ID。
- 操作状态转移、幂等标识、库存变更和流水写入必须在同一 SQLite 事务中完成。改造现有 applyStockOperation 的事务入口，不能先记 completed 再写库存，也不能嵌套 BEGIN。成功后响应丢失，重试仍返回原流水。
- 审批 POST 使用浏览器会话与 CSRF 防护，GET 绝不执行。Agent 获得的 OAuth token 不可调用审批接口。
- 拒绝、过期、冲突不扣库存。执行失败如确认可安全重试，仍使用原 operationId；结果未知先查流水，不能再次直接执行。

后续如要飞书卡片直接确认，需新增可信渠道回调、渠道账号绑定与消息签名验证。不能让 Agent 自己填写 confirmed=true 代替用户同意。第一版不实现这条分支。

## 5. 授权模型与页面

入口：“我的 → Agent 接入”，与 AI 模型配置分开。AI 模型配置是家藏向模型服务发请求，Agent 接入是外部客户端访问家藏数据，两者不共用 Key。

### 用户可见内容

- 管理员启用/停用 MCP，默认关闭；展示可访问地址和接入说明。普通成员只能管理自己的授权。
- 授权卡片：客户端名称、所属家庭、只读/允许提出变更、创建/到期时间、最近调用时间、有效/撤销/过期状态；支持查看记录和撤销。
- 新授权通过客户端发起 OAuth → 家藏登录 → 授权同意页 → 返回客户端；默认只读，不预勾写入。家藏登录后重新检查该用户身份，不能继承上一个用户的家庭选择。
- 同意页显示客户端身份、请求权限、选择家庭、授权有效期、家庭数据可能被发送到 Agent/模型服务的说明；要求的 scope 多于用户同意时按子集返回或拒绝，不隐式扩大。
- 选择“允许提出库存变更”时必须同时授予 inventory:read；history:read 独立可选。工具列表按 scope 裁剪，每次 tools/call 仍再校验。
- 授权默认 30 天，可选 7/30/90 天；到期必须重新同意，不自动变永久授权。
- 撤销授权、全局停用、用户移出家庭立即阻断后续调用和未执行确认操作，不能等 access token 自然过期。

### 身份与权限交集

实际能力 = 当前用户家庭权限 ∩ 授权 scope ∩ 服务端暴露的工具范围。家庭 owner/admin/member 的既有业务权限照旧，不因为 Agent 接入增加权限。普通成员不能授权应用管理能力；MCP 不接受 local-owner 开发回退或 x-trim-* 冒充网关身份。

## 6. 后续 OAuth 自动授权规划与传输约束（OAuth 尚未实现）

- 使用受维护 OAuth/MCP 库；实施阶段按选定 SDK 的稳定版本锁定依赖，先验证协议版本与客户端兼容矩阵，不手写另一套 JSON-RPC 或 OAuth 协议栈。
- 远程标准授权采用 Authorization Code + PKCE S256，严格校验 state、redirect_uri、client_id、resource/audience 和 scope；授权码一次性，建议 60 秒有效。
- access token 采用高熵不透明 token，建议 15 分钟有效；数据库只存摘要；每次调用检查 token、授权及当前成员资格，不把“token 未过期”当作唯一条件。
- refresh token 采用轮换、一次性使用，重复使用撤销对应 token 家族。授权总有效期仍是硬上限；只存摘要，不在日志中记录。
- 首版预注册实际验证通过的客户端，精确配置 redirect URI（必要的本机 loopback 依标准处理）；不默认开放任意动态注册或拉取任意远程 client metadata，避免额外 SSRF 面。
- 发布 Protected Resource Metadata 和授权服务器 metadata；未认证 MCP 返回标准 WWW-Authenticate，scope不足返回标准错误。预注册是客户端登记策略，不替代标准发现与 PKCE。
- metadata、issuer、resource 和 redirect 回调基于配置的可信外部地址生成，禁止直接使用客户端可伪造的 Host/X-Forwarded-* 构造；部署路径前缀必须保持一致。
- MCP 资源入口建议 /app/fnos-app-family-stock/mcp，管理界面/API 仍走飞牛登录。OAuth metadata 必须按规范支持资源路径发现；具体 well-known 路由经 SDK 与飞牛链路验证后锁定。
- 接口按当前稳定 Streamable HTTP 规范实现；2026-07-28 版删除 GET 长流与协议会话。旧协议客户端是否支持以实测明确，不将 MCP session ID 用作授权或用户身份。
- HTTPS 用于远程访问；本地开发仅 loopback。校验 Origin/可信 Host，缺 Origin 的非浏览器客户端仍须 token；不以 CORS 代替授权。不开放浏览器 Cookie 作为 MCP 认证方式。
- 不暴露整套既有 API 到外网。新 token 只对 MCP 资源有效，不能读取 AI Key、后台配置或冒用到其他应用。

### 飞牛部署验证是实施前置条件

必须实际验证：未登录浏览器的外部客户端能否访问 MCP 与 metadata；Authorization header 是否原样传入；飞牛网关是否强制跳登录；外部 HTTPS URL 的路径前缀是否保留；POST JSON/SSE、超时及 OAuth 回跳是否正常。

如果网关只接受浏览器会话，不能通过移除现有应用认证解决。采用独立的受保护 MCP 监听入口/受控反向代理，明确端口、TLS 与绑定地址，管理页仍留在原网关。用户不配置外部访问时允许局域网内受控部署，但不能宣传公网 Agent 可直接连接内网 URL。云端 Agent 的网络可达性与 OAuth 都要分别验证。

第一版完成至少一个实际目标客户端的 OAuth + 查询 + 待确认 + 结果读取联调；若客户端不支持所选规范，明确支持版本或使用 SDK 提供的兼容层，不静默降级成无鉴权入口。

## 7. 审计、限额与数据持久化（OAuth 专用表暂不创建）

建议新增数据结构（实际字段遵循现有迁移风格）：

| 表 | 关键职责 |
| --- | --- |
| agent_grants | userId、familyId、clientId、scopes、createdAt、expiresAt、revokedAt、lastUsedAt |
| oauth_codes | 一次性码摘要、PKCE challenge、redirectURI、resource、授权关联、有效期 |
| oauth_tokens | access/refresh 摘要、grantId、有效期、轮换家族、消耗/撤销状态 |
| agent_operations | grantId、requestId、toolName、规范参数、参数摘要、expectedVersion、状态、期限、确认人、结果/流水 ID |
| agent_call_logs | requestTraceId、grantId、toolName、耗时、结果码、关联 operationId、时间 |

数据库约束实现幂等唯一性与状态转移，不能仅靠内存锁。批次增加 version 字段，所有网页和 MCP 库存变更都递增；新迁移保留原数据，升级前备份并验证旧功能。

日志不记录 Bearer/refresh token、授权码、API Key、完整图片或整段聊天。审计展示中文操作名、实际操作者、客户端、对象/变更摘要、状态、错误与流水链接；默认保留 90 天并有界清理。正式库存流水遵循原有留存规则，不能随短期调用日志一起删除。待确认参数仅用于执行与追溯，拒绝/过期后按最小留存策略清理。

MCP 调用本身不产生模型 token 统计，外部 Agent 消耗无法凭空获知。若将来触发家藏内部 OCR/AI，关联任务 ID，展示家藏侧实际记录的调用/token，不能把外部消耗填成 0。

初始限额建议每授权查询 60 次/分钟、prepare 10 次/分钟、最多 20 个未结束操作；返回明确可重试时间。参数、列表、工具结果和请求体有上限。refresh 与轮询有退避，重试不能再次扣库存。

## 8. 实施顺序与验收

1. 接入验证：验证飞牛网络链路和一个目标 MCP 客户端，锁定外部 URL、协议版本、SDK 和 OAuth 库。交付可复现联调记录，未验证前不承诺特定 Agent 即插即用。
2. 授权 + 只读：关闭默认入口、同意页、scope/家庭绑定、撤销、metadata、只读工具和中文审计。验收查询/分页/临期语义及越权测试。
3. 写入闭环：prepare、家藏确认页、事务内执行、结果查询、版本检查、幂等与恢复。文字入库、消耗、丢弃、移动各完成一条完整链路。
4. 交付：接入说明、受支持客户端配置示例、授权管理 UI 桌面/触屏检查、升级保留数据验证。具备渠道入口的 Agent 用文本真实走通；没有渠道不影响 MCP 基础验收。

必须通过的用例：

- 无 token、错 audience、过期/撤销 token、停用 MCP、scope 不足均不可调用；MCP 未认证不回退管理员。
- 家庭 A token 访问家庭 B 的 batchId/locationId/operationId/游标无效，tools/list 与 call 均正确约束。
- 移出家庭、角色变化、授权到期/撤销在旧 token 和已打开确认页上立即生效。
- OAuth redirect、PKCE、state、授权码重放、刷新重放、授权 scope 扩张、伪造 forwarded header 均拒绝。
- 多个牛奶候选、缺单位、无到期日期、不同批次不能猜测执行；查询不混淆已过期/即将到期。
- 重复消息、响应丢失、双击确认、进程重启、事务中途失败：不重复入库/扣库存，结果可查询。
- prepare 后网页更改库存，确认冲突并要求重新确认；确认期间改用户/家庭无效。
- Agent 不能确认自己提出的操作；分享确认 URL 不赋予别人权限；CSRF/GET 不可执行。
- 原有网页入库、库存操作、家庭权限、SQLite 迁移与备份没有回归；日志与返回值无凭据泄露。

## 9. 消融与模板沉淀

规划消融检查已去掉：内置微信/飞书机器人、内置 Agent/模型编排、任意接口工具、首版自动写库存、MCP 审批工具、并行长期 API Key、默认动态客户端注册、单独开放全套 REST API。保留一个传输入口、一套 OAuth 授权、一组现有业务服务，避免重复功能与授权旁路。

可沉淀到模板：默认关闭的 Agent 接入管理、OAuth/授权范围与实时权限交集、调用审计与脱敏、待执行确认/原子幂等、部署验证与联调用例。家藏工具 schema、库存版本/单位/批次规则留在家藏。等本应用完成首轮验证后再抽离模板，不先造通用 Agent 平台。

## 10. 参考与状态说明

当前代码已增加 Agent 授权、待确认操作、调用日志与批次版本字段（schema v6），官方 SDK 真实实例测试使用独立临时库。OAuth 授权码/刷新 Token 表和自动授权流程尚未实现。实际飞牛安装和验收状态见体验基线文档。

官方参考（2026-11-28 核对）：

- MCP 授权：https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- Streamable HTTP：https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- 工具协议：https://modelcontextprotocol.io/specification/2026-07-28/server/tools


### 当前部署补充（1.0.4）

飞牛统一网关实测会先要求网页登录，外部 Agent 使用独立 MCP TCP 端口；管理及待确认页面继续走统一网关。独立端口默认关闭，仅同机/允许局域网可选，启用后随进程启动恢复。实现仍为手动 Bearer Token，本文前面 OAuth 部分为后续规划，未交付 OAuth 自动授权。实际操作方式以 MCP_USAGE.md 为准。
