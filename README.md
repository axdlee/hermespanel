# HermesPanel

面向 `hermes-agent` 的桌面管理客户端。

目标不是重做 Hermes 本体，而是提供一层 **0 侵入** 的本地客户端封装：

- 不修改 `hermes-agent` 源码
- 不侵入其运行时协议
- 只通过本地 `hermes` CLI、`~/.hermes` 目录、`state.db`、日志文件与 `gateway_state.json` 做管理

## 当前能力

- Profile 管理
  - 识别 Hermes `default` 与 `profiles/*`
  - 跟随当前 `active_profile`
  - 切换查看不同 profile 的本地状态
  - 将当前选择写回为 Hermes 默认 profile
  - 复用 `hermes profile create` 创建新 profile
  - 复用 `hermes profile rename` 重命名非 `default` profile
  - 复用 `hermes profile export` 导出 profile 归档
  - 复用 `hermes profile import` 导入 profile 归档
  - 复用 `hermes profile delete` 删除 profile，并要求输入完整名称确认
  - 展示 profile 路径、模型、gateway、技能数、会话数、`.env` / `SOUL.md` / alias 状态
- 仪表盘
  - Hermes Home / Binary / 版本信息
  - 模型、终端、人格、toolsets 摘要
  - 网关状态、平台状态、运行提醒
  - 最近会话与记忆文件概览
  - Cron 作业数量
- 网关控制
  - `hermes gateway start`
  - `hermes gateway restart`
  - `hermes gateway stop`
  - `hermes gateway status` 输出查看
- 配置中心
  - 读取和保存 `config.yaml`
  - 读取和保存 `.env`
- 会话浏览
  - 从 `~/.hermes/state.db` 读取最近会话
  - 查看单个会话的消息流水
- 技能目录
  - 扫描 `~/.hermes/skills/**/SKILL.md`
  - 解析 frontmatter 与分类
- Cron 作业
  - 读取当前 profile 下 `cron/jobs.json`
  - 展示调度、下次运行、最近运行、delivery、skills、错误信息
  - 复用 `hermes cron pause|resume|run` 做非破坏性操作
  - 复用 `hermes cron create|edit` 创建和编辑定时作业
  - 复用 `hermes cron remove` 删除作业，并要求输入完整 `job_id` 确认
- 日志查看
  - `agent.log`
  - `errors.log`
  - `gateway.log`
  - `gateway.error.log`
- 记忆文件
  - `SOUL.md`
  - `memories/MEMORY.md`
  - `memories/USER.md`
- 诊断面板
  - `hermes version`
  - `hermes status --all`
  - `hermes gateway status`
  - `hermes dump`
  - `hermes doctor`

## 架构

### 前端

`src/`

- `App.tsx`
  - 客户端壳、侧边导航、profile selector、通知层
- `pages/`
  - 按工作区拆分页面
  - `ProfilesPage.tsx` 负责 profile 管理
- `lib/api.ts`
  - Tauri `invoke` 与 profile 透传封装

### Tauri / Rust

`src-tauri/src/`

- `commands/`
  - Tauri 命令入口层
- `application/hermes_manager.rs`
  - 用例编排层
- `infrastructure/hermes.rs`
  - Hermes CLI / 文件系统 / SQLite / 日志读取的具体实现
- `models.rs`
  - 前后端共享 DTO

依赖方向：

`pages -> api -> commands -> application -> infrastructure`

这层次保证：

- UI 不知道 `~/.hermes` 的文件结构细节
- 命令入口不关心具体 SQL / 文件路径 / CLI 输出解析
- profile 切换只在命令参数和基础设施层收敛，不把 Hermes 目录规则散到页面里
- 后续要扩展 profile、多实例或远端代理时，可以先替换基础设施层

## 开发

### 前置条件

- Node.js 22+
- Rust 1.89+
- 本机已可执行 `hermes`

### 安装依赖

```bash
npm install
```

### 启动桌面客户端

```bash
npm run tauri:dev
```

### 前端构建

```bash
npm run build
```

### Rust 测试

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

### 桌面构建验证

```bash
npm run tauri build -- --debug
```

## 已验证

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run build`
- `npm run tauri build -- --debug`

## 设计取舍

- 选择 **Tauri 客户端**，不是浏览器 Web UI
- 选择 **本地封装**，不是把 Hermes 重新实现成另一套后端
- 当前优先做 **可用的单机桌面管理台 MVP**
- 破坏性操作目前只暴露到最小范围，没有直接在客户端里做会话删除、技能卸载、批量清理等高风险行为
- `cron remove` 已暴露，但要求前端输入完整 `job_id`，后端也会二次校验 `confirm_id === job_id`
- `profile delete` 已暴露，但要求前端输入完整名称确认，后端也会二次校验 `confirm_name === profile_name`
- `default` profile 不允许删除或重命名，优先保证 Hermes 默认实例始终可回退

## 下一步建议

- 增加技能内容详情与快速打开目录
- 支持会话全文检索与 source 过滤
- 增加更细粒度的 cron skill 编辑与启停批量操作
- 增加 profile alias 管理与导入结果的真实名称解析
- 增加多实例 / 多 Hermes Home 切换
