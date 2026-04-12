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
  - 在 macOS 下直接用 Finder 打开 profile 目录与定位 alias
  - 扫描 `~/.local/bin` 中指向当前 profile 的 wrapper alias
  - 复用 `hermes profile alias` 创建同名或自定义 alias
  - 复用 `hermes profile alias --remove` 删除指定 alias，并要求输入完整 alias 名称确认
  - 复用 `hermes profile create` 创建新 profile
  - 复用 `hermes profile rename` 重命名非 `default` profile
  - 复用 `hermes profile export` 导出 profile 归档
  - 复用 `hermes profile import` 导入 profile 归档
  - 复用 `hermes profile delete` 删除 profile，并要求输入完整名称确认
  - 展示 profile 路径、模型、gateway、技能数、会话数、`.env` / `SOUL.md` / alias 状态
- 仪表盘
  - Hermes Home / Binary / 版本信息
  - 当前 profile alias、最近刷新时间、会话 / 技能 / Cron / 日志 / 平台配置指标
  - 模型、终端、人格、toolsets 摘要
  - 网关状态、平台状态、运行提醒
  - 工作台快捷操作
    - 网关启动 / 重启 / 停止
    - Hermes 诊断命令快捷执行
    - macOS Finder 打开 Hermes Home / logs / cron 与定位 `config.yaml` / `.env` / 主 alias
    - 首页直达 `Profiles / Gateway / Config / Logs / Cron / Diagnostics`
  - 系统体检摘要
    - gateway、模型配置、`.env`、记忆文件、alias、工作区活跃度
  - 快捷输出面板
    - 展示最近一次工作台动作的命令、退出码、stdout / stderr
  - 日志尾部预览
    - 在首页直接读取 `gateway / gateway.error / agent / errors` 最近日志
  - 最近会话与记忆文件概览
  - `15s` 自动刷新开关
- 网关控制
  - `hermes gateway start`
  - `hermes gateway restart`
  - `hermes gateway stop`
  - `hermes gateway status` 输出查看
  - `hermes gateway status --deep` 深检
  - 展示平台连接健康、远端 delivery 作业依赖、交付异常与 `gateway_state.json` 快捷定位
- 配置中心
  - 读取和保存 `config.yaml`
  - 读取和保存 `.env`
  - 展示 `provider / model / context.engine / backend / toolsets / memory / user_profile / char limits / streaming` 编排摘要
  - 在 macOS 下直接打开 Hermes Home、定位 `config.yaml`、`.env`
  - 从配置页直接跳转到 `Skills / Memory / Diagnostics / Logs`
  - 编辑器展示 YAML / ENV 未保存状态
- 会话浏览
  - 从 `~/.hermes/state.db` 读取最近会话
  - 按 `source / model / 时间窗 / 关键词` 过滤会话
  - 查看单个会话的消息流水
  - 按 `user / assistant / tool` 过滤消息
  - 展示消息数、工具调用数、模型和时间线
  - 在 macOS 下直接在 Finder 中定位 `state.db`
  - 从会话页直接跳转到日志页、诊断页和记忆页
- 技能目录
  - 扫描 `~/.hermes/skills/**/SKILL.md`
  - 解析 frontmatter 与分类
  - 按分类、关键词过滤技能
  - 展示 skills 与 `toolsets / backend / memory / gateway / cron` 的能力关系
  - 查看单个 skill 的详情、预览、文件路径
  - 展示当前 skill 是否已经被 cron 作业引用，以及对应作业的状态、交付目标和下次运行时间
  - 在 macOS 下直接定位 skill 文件与打开 skill 目录
- 扩展能力台
  - 结构化展示 `hermes tools --summary`
  - 结构化展示 `hermes memory status`
  - 结构化展示 `hermes plugins list`
  - 结构化展示 `hermes skills list` 的 `source / trust / category` 运行态分布
  - 对照本地技能目录扫描结果，识别“CLI 安装态”和“文件态”差异
  - 展示 Hermes 当前真正暴露出来的工具面、记忆 provider 和扩展层，而不只是本地文件存在与否
- Cron 作业
  - 读取当前 profile 下 `cron/jobs.json`
  - 展示调度、下次运行、最近运行、delivery、skills、错误信息
  - 展示自动化闭环健康：`skills / memory / gateway / delivery`
  - 检查 `jobs.json` 中引用的 skills 是否真实存在于当前 profile
  - 在 macOS 下直接用 Finder 定位 `jobs.json`
  - 复用 `hermes cron pause|resume|run` 做非破坏性操作
  - 复用 `hermes cron create|edit` 创建和编辑定时作业
  - 复用 `hermes cron remove` 删除作业，并要求输入完整 `job_id` 确认
- 日志查看
  - `agent.log`
  - `errors.log`
  - `gateway.log`
  - `gateway.error.log`
  - 针对 `gateway / provider / cron / tool error` 的日志预设
  - `5s` 自动刷新日志
  - 在 macOS 下直接打开 logs 目录或在 Finder 中定位当前日志文件
  - 从日志页直接跳转到诊断页、网关页和工作台
- 记忆编排
  - `SOUL.md`
  - `memories/MEMORY.md`
  - `memories/USER.md`
  - 展示 `memory.provider / memory_enabled / user_profile_enabled / memory_char_limit / user_char_limit`
  - 从客户端同时查看记忆文件状态、运行开关、会话验证条件与 gateway 状态
  - 在 macOS 下直接定位当前记忆文件与打开所在目录
- 诊断面板
  - `hermes version`
  - `hermes status --all`
  - `hermes status --deep`
  - `hermes gateway status`
  - `hermes gateway status --deep`
  - `hermes dump`
  - `hermes doctor`
  - `hermes config check`
  - `hermes tools --summary`
  - `hermes skills list`
  - `hermes plugins list`
  - `hermes memory status`
  - 诊断上下文摘要
    - 当前 profile、binary、gateway、provider、`context.engine`、backend、toolsets、memory / streaming 开关
  - 风险体检
    - 自动串联 `cron / skills / memory / gateway / config` 的结构性风险
  - 相关日志预览
    - 根据诊断命令联动切换到更相关的日志类型
  - Finder 与页面联动入口
    - 直接打开 Home / logs，定位 `config.yaml`、`.env`，并跳转到 `Logs / Gateway / Config / Cron / Memory`

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
- `commands/extensions.rs`
  - Hermes 扩展能力快照入口

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
- 诊断命令改成显式白名单映射，只包装安全、非交互的 Hermes 原生命令，避免把 CLI 交互 UI 误塞进桌面客户端
- 对 `hermes tools --summary` 这类要求 TTY 的命令，客户端会通过伪终端包装执行，但本质上仍然是在调用 Hermes 原生 CLI
- `cron remove` 已暴露，但要求前端输入完整 `job_id`，后端也会二次校验 `confirm_id === job_id`
- `profile alias --remove` 已暴露，但要求前端输入完整 alias 名称，后端也会二次校验 `confirm_name === alias_name`
- `profile delete` 已暴露，但要求前端输入完整名称确认，后端也会二次校验 `confirm_name === profile_name`
- `default` profile 不允许删除或重命名，优先保证 Hermes 默认实例始终可回退

## 下一步建议

- 增加技能内容详情与快速打开目录
- 支持会话全文检索与 source 过滤
- 增加更细粒度的 cron skill 编辑与启停批量操作
- 增加 profile alias 冲突预检查提示与导入结果的真实名称解析
- 增加多实例 / 多 Hermes Home 切换
