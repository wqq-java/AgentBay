# Claude Code 内部接口实测记录

> 探测时间:2026-05-13
> 探测方式:**纯只读**——读取 `~/.claude/projects/**/*.jsonl` 真实历史 + 反向阅读 `~/.claude/hooks/vibehub-state.py` 与 `claude-island-state.py`。未修改 global settings.json。
> CC 升级后建议重新跑探测,关键字段名可能变。

---

## 1. Hook payload(JSON via stdin)

### 1.1 通道

CC 调用 hook 时,把 payload 作为 **JSON 写入 hook 进程的 stdin**。Hook 命令在 `~/.claude/settings.json` 的 `hooks.<EventName>[].hooks[].command` 字段定义,例:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "/path/to/script.sh" }] }
    ]
  }
}
```

### 1.2 通用字段(所有 event 都有)

| 字段 | 类型 | 说明 |
|---|---|---|
| `hook_event_name` | string | **事件名**(不是 `event`!这是个常见误解)。值如 `SessionStart`, `PreToolUse`, `Notification`, `Stop`, `UserPromptSubmit`, ... |
| `session_id` | string | UUID,对应 jsonl 文件名 |
| `cwd` | string | 绝对路径,workspace 归类用 |

### 1.3 PreToolUse / PostToolUse 额外字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `tool_input` | object | 工具调用入参(键名取决于工具,如 Bash → `{command, description}`) |
| `tool_name` | string | 工具名(待二次确认,vibehub 里没用) |
| `tool_use_id` | string | 与 jsonl 里 `tool_use.id` 对应,用于 PostToolUse 关联 PreToolUse |

### 1.4 Notification / PermissionRequest 额外字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `message` | string | 通知文本 |

### 1.5 SessionStart / Stop / UserPromptSubmit

只用通用字段。`UserPromptSubmit` 可能带 `prompt` 字段(待实测确认)。

### 1.6 注入到 stdin 的实证片段(摘自 vibehub)

```python
data = json.load(sys.stdin)
session_id = data.get("session_id", "unknown")
event = data.get("hook_event_name", "")
cwd = data.get("cwd", "")
tool_input = data.get("tool_input", {})
```

### 1.7 daemon 端处理建议

- `hookEventSchema` 字段名用 `hook_event_name`(不是 `event`)
- 用 `z.passthrough()` 容忍未知字段(forward-compatible)
- 没有 `timestamp` 字段——daemon 在收到时打 `Date.now()` 时间戳

---

## 2. Jsonl 文件格式

### 2.1 位置

```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

`<encoded-cwd>` = cwd 路径中**所有** `/` 替换成 `-`。例 `/Users/eoi/EOI` → `-Users-eoi-EOI`(首字符的 `/` 也变 `-`)。
**注:**这个编码不可逆(原本 path 里就有 `-` 时);**daemon 应该从 jsonl 里读 `cwd` 字段而不是反编码目录名**。

### 2.2 行 type 分布(单个文件样本,200 行)

```
assistant: 67       — Claude 的回应,内含 content blocks 和 usage
user: 43            — 用户消息 / tool_result 反馈
system: 29          — hook 触发结果、stop 原因等元信息
file-history-snapshot: 18  — 上下文压缩前的快照(rare,可忽略)
last-prompt: 12     — 元数据,指向最后一个用户 prompt 的 UUID
permission-mode: 12 — 元数据,当前 permission 模式
ai-title: 11        — 元数据,Claude 给会话起的标题
attachment: 8       — hook 输出的 stdout/stderr 反馈
```

### 2.3 通用字段(message 类行:assistant/user/system/attachment)

```typescript
{
  type: 'assistant' | 'user' | 'system' | 'attachment',
  uuid: string,                  // 此条 UUID
  parentUuid: string | null,     // 父节点 UUID(线性链)
  sessionId: string,             // = 文件名(不含 .jsonl)
  cwd: string,                   // 写这条时的工作目录
  timestamp: string,             // ISO 8601:'2026-05-13T07:05:51.895Z'
  isSidechain: boolean,          // teammate 派发后的旁支
  version: string,               // CC 版本号
  userType: string,
  entrypoint: string,
  gitBranch: string,             // 此条所在 git 分支
}
```

**关键 1:`timestamp` 是 ISO 字符串,不是 epoch ms。** daemon 解析时需用 `Date.parse(timestamp)` 转 ms。
**关键 2:`isSidechain: true` 表示这条属于 teammate(subagent)的对话,不是主线**。聚合时按 `parentUuid` 链 + `isSidechain` 判断归属哪个 agent。

### 2.4 meta 行(简短的)

```jsonc
{ "type": "last-prompt", "leafUuid": "<uuid>", "sessionId": "..." }
{ "type": "permission-mode", "permissionMode": "default", "sessionId": "..." }
{ "type": "ai-title", "aiTitle": "...", "sessionId": "..." }
```

不参与对话内容,daemon 可忽略或仅用于补全 UI 标题。

### 2.5 assistant.message 结构(Anthropic API 包装)

```typescript
message: {
  model: string,             // 例 'claude-opus-4-7'
  id: string,
  type: 'message',
  role: 'assistant',
  content: ContentBlock[],   // 见 2.6
  stop_reason: string,
  stop_sequence: string | null,
  stop_details: object,
  usage: Usage,              // 见 2.7
  diagnostics: object,
}
```

### 2.6 content block 类型

实测分布(单个文件 67 个 assistant 行):

| block.type | 出现次数 | 关键字段 |
|---|---|---|
| `tool_use` | 51 | `id`, `name`, `input` |
| `thinking` | 41 | `thinking`(extended thinking 内容) |
| `text` | 33 | `text` |

**关键 3:tool_use 不是单独的 jsonl 行,而是嵌在 assistant.message.content 数组里的 block。** PreToolUse hook 触发时也是这个 tool_use_id。

### 2.7 user.message 结构

```typescript
message: {
  role: 'user',
  content: string | ContentBlock[],  // 工具结果时 content 是 [{type:'tool_result', tool_use_id, content}]
}
```

### 2.8 usage 结构(token 计数,在 assistant.message.usage)

```typescript
usage: {
  input_tokens: number,
  output_tokens: number,
  cache_creation_input_tokens: number,
  cache_read_input_tokens: number,
  cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens },
  server_tool_use: { web_search_requests, web_fetch_requests },
  service_tier: string,
  speed: string,
  iterations: Array<{ ... }>,
}
```

**daemon 累计 token 公式**(用于状态卡片上的 token 条):
```
total = input + output + cache_creation + cache_read
```

### 2.9 system 行(hook 反馈 + stop 原因)

```typescript
{
  type: 'system',
  subtype: string,           // 例 'hook_response'
  hookCount: number,
  hookInfos: object[],
  hookErrors: object[],
  preventedContinuation: boolean,
  stopReason: string,
  hasOutput: boolean,
  level: string,
  toolUseID: string,
  // + 通用字段
}
```

---

## 3. Session 与 Project 目录映射

| 现象 | 含义 |
|---|---|
| `~/.claude/projects/-Users-eoi-EOI/` | 一个 project 目录,对应原 cwd `/Users/eoi/EOI`(简单情况) |
| `~/.claude/projects/-Users-eoi-EOI/abc.jsonl` | 一个 session,session_id = `abc` |
| 一个 cwd 下可能有多个 jsonl | 多次启动 CC = 多个 session,文件名都用 sessionId |
| 编码名 + 真实 cwd 不一定能完美还原 | 优先**从 jsonl 第一行的 `cwd` 字段**读真实 cwd |

---

## 4. 对 daemon 实现的影响(需要在 plan 里更正的地方)

1. **`hookEventSchema` 中字段名用 `hook_event_name`,不是 `event`**
2. **`HookEvent.session_id` 与 SQL `sessions.id` 完全一致**(都是 UUID)
3. **timestamp 处理**:hook payload 没有 timestamp → 用 `Date.now()`;jsonl 行的 timestamp 是 ISO 字符串 → 用 `Date.parse()` 转 ms
4. **Agent 归属**:不是用 hook(SubagentStart 是否存在还待实测),而是用 jsonl 的 `isSidechain` + `parentUuid` 链反推
5. **token 累计**:累加每行 assistant.message.usage 的 4 个字段
6. **content block 解析**:tool_use 和 tool_result 都是嵌套块,不是独立行

---

## 5. 尚未验证(M2 之前需要补做)

- [ ] PreToolUse / PostToolUse 的完整 payload(`tool_input` / `tool_output` 的形状,`tool_use_id` 是否存在)
- [ ] Stop / SubagentStop / UserPromptSubmit 是否有额外字段
- [ ] PermissionRequest 的具体 payload + 响应协议
- [ ] CC 是否真的有 `SubagentStart` / `SubagentStop` event(vibehub 没用过——可能是 `Notification` matcher 走的)
- [ ] `isSidechain` 与 teammate 的具体对应关系(一个 teammate 一个 sidechain 还是一对多)

**验证方法**:M2 实施前,在临时 settings.json 里挂一个 dump hook 跑一次有 Agent 工具调用的真实会话。
