# Project Memory

这个文件是项目级快速定位索引。后续处理问题时，优先先看这里，再决定是否需要全局搜索。

## 1. 当前项目定位

- 项目：`Island_Win`
- 技术栈：Electron + React + TypeScript
- 主目标：Windows 版 AI Agent 灵动岛/状态岛
- 当前状态：仓库里有未提交改动，主要集中在权限弹窗、宽度估算、阴影裁剪、关闭闪烁、跳转行为

## 2. 最高频入口文件

### 主进程

- [src/main/index.ts](/M:/ai-harness/island/src/main/index.ts)
  - Electron 窗口创建、尺寸计算、位置更新
  - island 布局 IPC
  - 权限请求接收与响应分发
  - jump 入口
- [src/main/ipcServer.ts](/M:/ai-harness/island/src/main/ipcServer.ts)
  - `/v1/events`
  - `/v1/permission/request`
  - `/v1/question/request`
  - `/v1/permission/respond`
- [src/main/state.ts](/M:/ai-harness/island/src/main/state.ts)
  - 全局状态
  - session/events/permission 队列
  - 待处理请求管理
- [src/main/jump.ts](/M:/ai-harness/island/src/main/jump.ts)
  - 工作区/终端/精准跳转实现
- [src/main/sessionDiscovery.ts](/M:/ai-harness/island/src/main/sessionDiscovery.ts)
  - 本地 transcript/session 扫描
  - 目前有性能关注点：大 transcript 读取
- [src/main/remoteServer.ts](/M:/ai-harness/island/src/main/remoteServer.ts)
  - 远程通知/审批 endpoint
  - 默认应走 localhost
- [src/main/usage.ts](/M:/ai-harness/island/src/main/usage.ts)
  - Claude/Codex usage 数据读取
- [src/main/diagnostics.ts](/M:/ai-harness/island/src/main/diagnostics.ts)
  - 诊断快照

### 渲染进程

- [src/renderer/src/App.tsx](/M:/ai-harness/island/src/renderer/src/App.tsx)
  - `IslandView`
  - 权限 notice 状态机
  - 宽度估算
  - 展开/收起逻辑
  - 当前 UI 闪烁、裁剪、切态问题首查这里
- [src/renderer/src/PermissionPanel.tsx](/M:/ai-harness/island/src/renderer/src/PermissionPanel.tsx)
  - 详细面板里的权限/问题操作按钮
  - 回答输入、选项、提交动作
- [src/renderer/src/SettingsView.tsx](/M:/ai-harness/island/src/renderer/src/SettingsView.tsx)
  - 设置页
  - hook/plugin/usage/diagnostics/实验开关
- [src/renderer/src/styles.css](/M:/ai-harness/island/src/renderer/src/styles.css)
  - 灵动岛外观
  - 阴影、圆角、尺寸、动画、按钮布局
  - 当前视觉问题首查这里
- [src/renderer/src/i18n.ts](/M:/ai-harness/island/src/renderer/src/i18n.ts)
  - 文案语言切换

### 共享逻辑

- [src/shared/types.ts](/M:/ai-harness/island/src/shared/types.ts)
  - 核心类型定义
  - `AppConfig`、`AgentSession`、`PermissionRequest`、`PermissionResponse`
- [src/shared/normalize.ts](/M:/ai-harness/island/src/shared/normalize.ts)
  - agent payload 标准化
- [src/shared/attention.ts](/M:/ai-harness/island/src/shared/attention.ts)
  - 事件关注度判定
  - `idle_prompt` / `input_waiting` 等提示信号过滤
- [src/shared/permission.ts](/M:/ai-harness/island/src/shared/permission.ts)
  - 权限请求辅助逻辑

## 3. 问题类型 -> 优先查看文件

- 权限请求没有显示 / 没有按钮
  - `src/shared/normalize.ts`
  - `src/shared/attention.ts`
  - `src/main/ipcServer.ts`
  - `src/main/index.ts`
  - `src/renderer/src/App.tsx`
- 点击允许/拒绝后 Claude 无响应
  - `src/renderer/src/PermissionPanel.tsx`
  - `src/main/index.ts`
  - `src/main/ipcServer.ts`
- 灵动岛宽度不对 / 文本裁剪 / 按钮被挤压
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/styles.css`
- 收起或关闭时黑色闪烁 / 下方闪一下
  - `src/renderer/src/App.tsx`
  - `src/renderer/src/styles.css`
  - `src/main/index.ts`
- 阴影被截断
  - `src/renderer/src/styles.css`
  - `src/main/index.ts`
- 跳转失败 / 跳错目标 / 总是打开工作区
  - `src/main/jump.ts`
  - `src/main/index.ts`
  - `src/shared/types.ts`
- session 恢复 / 自动发现异常
  - `src/main/sessionDiscovery.ts`
  - `src/main/state.ts`
- 设置项无效 / 默认值不对
  - `src/shared/types.ts`
  - `src/main/storage.ts`
  - `src/renderer/src/SettingsView.tsx`
- 远程通知风险或绑定地址问题
  - `src/main/remoteServer.ts`

## 4. 当前已知未完全收口项

- `sessionDiscovery` 仍可能完整读取 transcript，大文件下启动扫描会慢
- 最近一轮 UI 修补主要针对：
  - 权限 notice 宽度与裁剪
  - 关闭时黑色闪烁
  - 阴影截断
- 这些修补已经落到本地未提交改动里，但用户还没有最终确认视觉问题已完全消失

## 5. 常用验证命令

### 测试与构建

```powershell
npm test
npm run build
npm run package:dir
```

### 重启已打包应用

```powershell
Get-Process | Where-Object { $_.ProcessName -like 'Vibe Island*' } | Stop-Process -Force
Start-Process -FilePath "M:\ai-harness\island\release\win-unpacked\Vibe Island.exe" -WindowStyle Hidden
```

### 发送手动权限请求

```powershell
$runtime = Get-Content "$env:APPDATA\Vibe Island\runtime.json" -Raw | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($runtime.token)"; 'Content-Type' = 'application/json' }
$body = @{
  agent='claude'
  hook_event_name='PermissionRequest'
  request_id=('demo-manual-' + [DateTimeOffset]::Now.ToUnixTimeMilliseconds())
  session_id='demo-manual'
  cwd='M:\ai-harness\island'
  tool_name='Bash'
  tool_input=@{ command='Remove-Item -Recurse M:\ai-harness\island\demo-temp' }
  action='记忆文件后续验证'
  message='用于验证灵动岛权限弹窗'
  risk='high'
  timeout_ms=30000
} | ConvertTo-Json -Depth 8
Start-Job -ScriptBlock {
  param($uri, $headers, $body)
  Invoke-WebRequest -UseBasicParsing -Headers $headers -Method Post -Uri $uri -Body $body | Out-Null
} -ArgumentList ("http://{0}:{1}/v1/permission/request?agent=claude" -f $runtime.host,$runtime.port), $headers, $body
```

## 6. 运行数据位置

- `%APPDATA%\Vibe Island\runtime.json`
- `%APPDATA%\Vibe Island\config.json`
- `%APPDATA%\Vibe Island\sessions.json`
- `%APPDATA%\Vibe Island\events.jsonl`
- `%APPDATA%\Vibe Island\spool.jsonl`

## 7. 使用约定

- 后续定位问题时，先查这个文件的“问题类型 -> 优先查看文件”
- 如果问题和这里不匹配，再做局部搜索，而不是全仓库大范围扫描
- 这里应该只保留高频入口、常见命令、正在演进的问题，不写大段背景说明
