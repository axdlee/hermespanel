<p align="center">
  <img src="src-tauri/icons/icon.png" width="144" alt="HermesPanel">
</p>

<h1 align="center">HermesPanel</h1>

<p align="center">
  面向 <a href="https://github.com/nousresearch/hermes-agent">hermes-agent</a> 的桌面管理客户端
  <br>
  把安装、配置、网关、扩展、技能、日志与诊断尽量收回到一个可分发的桌面应用里
</p>

<p align="center">
  <a href="https://github.com/axdlee/hermespanel/releases/latest">
    <img src="https://img.shields.io/github/v/release/axdlee/hermespanel?style=flat-square&label=Release" alt="Release">
  </a>
  <a href="https://github.com/axdlee/hermespanel/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/axdlee/hermespanel/ci.yml?style=flat-square&label=CI" alt="CI">
  </a>
  <a href="https://github.com/axdlee/hermespanel/actions/workflows/release.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/axdlee/hermespanel/release.yml?style=flat-square&label=Release%20Build" alt="Release Build">
  </a>
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-workbench.png" alt="HermesPanel Dashboard" width="96%">
</p>

<table>
  <tr>
    <td width="50%">
      <img src="docs/screenshots/config-workbench.png" alt="HermesPanel Config">
    </td>
    <td width="50%">
      <img src="docs/screenshots/gateway-workbench.png" alt="HermesPanel Gateway">
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <img src="docs/screenshots/extensions-workbench.png" alt="HermesPanel Extensions">
    </td>
  </tr>
</table>

## 项目定位

HermesPanel 不是 Hermes 的替代品，也不是另起一套后端服务。

它的定位很明确：

- 不修改 `hermes-agent` 源码
- 不替代 `hermes` CLI 的协议和运行机制
- 不接管 Hermes 的常驻运行模型
- 只围绕本机 `~/.hermes`、`config.yaml`、`.env`、`gateway_state.json`、`state.db`、日志与 CLI 能力做桌面治理

更直接一点说，它想解决的是这类问题：

- 新用户不想在终端、配置文件、日志目录之间来回跳
- 熟练用户不想每次改模型、通道、Gateway、技能、插件都手敲命令
- 诊断问题时，希望配置态、运行态、日志态能放在一个桌面应用里对照

## 现在能做什么

### 高频能力

- 配置中心
  - 模型、Provider、Base URL、Toolsets、Terminal、Memory、凭证、消息通道
  - 结构化写回 `config.yaml` / `.env`
- Gateway
  - Service 启停
  - Gateway Token、策略、通道接入
  - 保存后直接启动或重启，形成闭环
- 技能与扩展
  - 本地 skills 创建、导入、编辑、删除
  - 插件目录、manifest、README、本地导入与删除
  - Tools / Plugins / Memory runtime 对照
- 运行排查
  - 日志、诊断、Session、Cron、Memory
  - 最近回执、日志下钻、运行材料统一查看

### 产品设计方向

- 一级页只保留最常用入口和主判断
- 低频功能继续后置到二级、三级工作面
- 能在客户端里结构化直写的，不默认把用户赶回命令行
- 配置态、运行态、日志态尽量做同屏对照

## 为什么用 Tauri

- 需要直接管理本机 `~/.hermes`
- 需要打开目录、定位文件、查看日志、触发本地命令
- 需要打包成真正可安装、可分发的桌面应用
- 需要保持对 Hermes 的低侵入，不重写 Hermes 本身

## 下载与安装

Release 已经准备好多平台自动构建：

- macOS Apple Silicon
- macOS Intel
- Linux
- Windows 标准安装包
- Windows 完整包
  - 内置离线 WebView2 安装器，适合内网或目标机器缺失 WebView2 的场景

下载地址：

- `Releases`：<https://github.com/axdlee/hermespanel/releases/latest>

安装建议：

- macOS 按芯片架构选择 Apple Silicon / Intel 对应版本
- Windows 已安装 WebView2 时优先使用标准包
- Windows 内网、离线或 WebView2 环境不稳定时使用 `full` 包

## 快速开始

### 我只是想先跑起来

```bash
npm ci
npm run tauri:dev
```

### 我想在提交前先对齐 GitHub CI

```bash
npm run check:ci
```

### 我想本地先做一遍桌面端打包

```bash
npm run tauri:build
```

## 本地开发

### 前置条件

- Node.js 22+
- Rust stable
- 本机可执行 `hermes`
- macOS 需要 Xcode Command Line Tools
- Linux 打包需要 Tauri 依赖库
- Windows 打包依赖 WebView2，离线场景可使用完整包工作流

### 安装依赖

```bash
npm ci
```

### 启动桌面端

```bash
npm run tauri:dev
```

### 常用命令

```bash
# 前端构建
npm run build

# 本地调试打包
npm run tauri:build:debug

# 前端 + Rust tests
npm run check

# 与 GitHub Actions 对齐的完整检查
npm run check:ci
```

### 与 GitHub CI 对齐的本地检查

```bash
npm run check:ci
```

## GitHub Actions 与发布链路

仓库自带两条工作流：

- `.github/workflows/ci.yml`
  - macOS / Linux / Windows 三平台检查
  - `cargo fmt --check`
  - `cargo clippy -D warnings`
  - `cargo test`
  - `npm run build`
- `.github/workflows/release.yml`
  - 推送 `v*` 标签自动发布
  - 也支持手动触发 `workflow_dispatch`
  - 先创建或复用当前 Tag 对应的 GitHub Release
  - 多平台 Tauri 打包
  - Windows 标准包与完整包双产物
  - 自动更新 Release Notes

发布触发方式：

```bash
git tag v0.1.0
git push origin v0.1.0
```

发布链路现在的设计重点是：

- 先准备 Release，再并行上传各平台产物，避免多平台任务并发创建 Release 的竞态
- Windows 完整包单独开启离线 WebView2 模式，并把产物重命名为 `-full`
- `gh` 相关步骤统一使用 `GH_TOKEN`
- 本地可先执行 `npm run check:ci`，把最常见的 CI 失败点挡在推送前

## 构建与发布排查

| 现象 | 常见原因 | 建议处理 |
| --- | --- | --- |
| `cargo fmt --check` 失败 | Rust 文件格式未同步 | 先运行 `cargo fmt --manifest-path src-tauri/Cargo.toml --all` |
| `cargo clippy -D warnings` 失败 | 本地没提前跑严格 lint | 先运行 `npm run check:ci`，把 warning 当错误处理 |
| Linux runner 构建失败 | 缺少 WebKit / GTK 依赖 | 参考 workflow 中的 apt 依赖列表，确保本地与 CI 一致 |
| Windows 安装包启动异常 | 目标机缺少或损坏 WebView2 | 改用 Release 中的 Windows `full` 包 |
| Release 上传失败 | 认证变量或 Release 状态异常 | 确认 workflow 中 `GH_TOKEN` 已注入，且 tag 对应的 Release 可访问 |

## 平台说明

### macOS

- 开发与打包建议使用与目标架构一致的机器
- 如果截图脚本抓不到窗口，先检查“屏幕与系统音频录制”权限

### Linux

- CI 使用系统依赖安装方式，不依赖额外容器
- 若本地需要手工补齐依赖，可参考 `.github/workflows/ci.yml`

### Windows

- 标准包适合已经具备 WebView2 Runtime 的机器
- 完整包适合离线、内网或企业受限环境
- 完整包会单独启用 Tauri 的离线 WebView2 安装模式

## 项目结构

```text
src/
  pages/                 桌面端旧页面体系与工作台 UI
  lib/                   前端状态、API 封装、辅助逻辑

src-tauri/
  src/commands/          Tauri 命令入口
  src/application/       用例编排层
  src/infrastructure/    Hermes CLI / 文件 / SQLite / 日志封装
  tauri.conf.json        Tauri 打包配置

.github/workflows/
  ci.yml                 三平台检查
  release.yml            多平台发布
```

依赖方向保持为：

`pages -> api -> commands -> application -> infrastructure`

这样 UI 改版不会直接碰底层 Hermes 解析和写回逻辑。

## 截图与文档素材

README 当前使用这些截图：

- `docs/screenshots/dashboard-workbench.png`
- `docs/screenshots/config-workbench.png`
- `docs/screenshots/gateway-workbench.png`
- `docs/screenshots/extensions-workbench.png`

macOS 下可直接抓桌面窗口：

```bash
npm run docs:capture:mac
```

如果抓图失败，通常是终端没有获得：

- 屏幕与系统音频录制

## 常见问题

### 1. 为什么 GitHub Actions 会失败

这类项目最常见的失败点不是 Tauri 本身，而是：

- Rust 文件未格式化，`cargo fmt --check` 失败
- Clippy 在 GitHub 上按 `-D warnings` 执行，本地没提前跑过
- Linux runner 缺少 Tauri 依赖库
- Release 工作流里目标平台参数或发布步骤不够稳健

当前仓库已经把这些检查和发布动作收进 workflow 里，建议在推送前先跑一遍 `npm run check:ci`。

### 2. 为什么有些动作仍然会调用 Hermes CLI

HermesPanel 的原则不是绕开 Hermes，而是把 CLI 能力桌面化、结构化、可视化。

所以目前会分成两类：

- 能结构化直写的，尽量直接在客户端内完成
- 真正触及 Hermes 原生行为边界的，继续通过后端封装调用 CLI

### 3. 为什么截图脚本抓不到窗口

通常是 macOS 权限问题，不是脚本本身问题。请确认当前终端已经获得：

- 屏幕与系统音频录制

## 当前限制

- 少数 Hermes 官方交互式能力，仍然需要通过底层 CLI 执行
- 大页虽然已经持续收敛，但还在继续把低频动作往更深层级后置
- README 目前以核心工作面截图为主，后续还可以继续补技能、诊断、自动化等页面截图

## 接下来

- 继续收薄大页层级，把更多低频能力后置
- 进一步把配置态、运行态、日志态合成更短的闭环路径
- 继续完善 README、截图、发布说明和多平台安装体验
