use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{AppError, AppResult};
use crate::models::{CommandRunResult, DesktopOpenRequest, DesktopTerminalRequest};

pub fn open_in_finder(request: &DesktopOpenRequest) -> AppResult<CommandRunResult> {
    let path = request.path.trim();
    if path.is_empty() {
        return Err(AppError::Message("打开 Finder 的 path 不能为空".into()));
    }

    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(AppError::Message(format!(
            "目标路径不存在: {}",
            target.display()
        )));
    }

    let (program, args) = build_open_in_finder_command(&target, request.reveal_in_finder)?;
    let output = Command::new(&program).args(&args).output()?;
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(CommandRunResult {
        command: format!("{} {}", program, args.join(" ")).trim().to_string(),
        exit_code,
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        success: output.status.success(),
    })
}

pub fn open_in_terminal(request: &DesktopTerminalRequest) -> AppResult<CommandRunResult> {
    let command = request.command.trim();
    if command.is_empty() {
        return Err(AppError::Message(
            "打开 Terminal 的 command 不能为空".into(),
        ));
    }

    let working_directory = request
        .working_directory
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    if let Some(path) = &working_directory {
        if !path.exists() {
            return Err(AppError::Message(format!(
                "Terminal 工作目录不存在: {}",
                path.display()
            )));
        }
    }

    let display_command = build_terminal_shell_command(command, working_directory.as_deref());
    let (program, args) = build_open_in_terminal_command(command, working_directory.as_deref())?;
    let output = Command::new(&program).args(&args).output()?;
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(CommandRunResult {
        command: display_command,
        exit_code,
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        success: output.status.success(),
    })
}

#[cfg(target_os = "macos")]
fn build_open_in_finder_command(
    path: &Path,
    reveal_in_finder: bool,
) -> AppResult<(String, Vec<String>)> {
    let mut args = Vec::new();
    if reveal_in_finder {
        args.push("-R".to_string());
    }
    args.push(path.display().to_string());
    Ok(("open".to_string(), args))
}

#[cfg(not(target_os = "macos"))]
fn build_open_in_finder_command(
    _path: &Path,
    _reveal_in_finder: bool,
) -> AppResult<(String, Vec<String>)> {
    Err(AppError::Message(
        "当前实现仅支持 macOS Finder 打开能力".into(),
    ))
}

fn build_terminal_shell_command(command: &str, working_directory: Option<&Path>) -> String {
    let normalized = command.trim();
    match working_directory {
        Some(path) => format!(
            "cd {} && {}",
            shell_quote(&path.display().to_string()),
            normalized
        ),
        None => normalized.to_string(),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn build_open_in_terminal_command(
    command: &str,
    working_directory: Option<&Path>,
) -> AppResult<(String, Vec<String>)> {
    let mut args = vec![
        "-e".to_string(),
        "on run argv".to_string(),
        "-e".to_string(),
        "set targetCommand to item 1 of argv".to_string(),
        "-e".to_string(),
        "set targetDirectory to \"\"".to_string(),
        "-e".to_string(),
        "if (count of argv) > 1 then set targetDirectory to item 2 of argv".to_string(),
        "-e".to_string(),
        "if targetDirectory is not \"\" then".to_string(),
        "-e".to_string(),
        "  set shellCommand to \"cd \" & quoted form of targetDirectory & \" && \" & targetCommand"
            .to_string(),
        "-e".to_string(),
        "else".to_string(),
        "-e".to_string(),
        "  set shellCommand to targetCommand".to_string(),
        "-e".to_string(),
        "end if".to_string(),
        "-e".to_string(),
        "tell application \"Terminal\"".to_string(),
        "-e".to_string(),
        "  activate".to_string(),
        "-e".to_string(),
        "  do script shellCommand".to_string(),
        "-e".to_string(),
        "end tell".to_string(),
        "-e".to_string(),
        "end run".to_string(),
        "--".to_string(),
        command.trim().to_string(),
    ];

    if let Some(path) = working_directory {
        args.push(path.display().to_string());
    }

    Ok(("osascript".to_string(), args))
}

#[cfg(not(target_os = "macos"))]
fn build_open_in_terminal_command(
    _command: &str,
    _working_directory: Option<&Path>,
) -> AppResult<(String, Vec<String>)> {
    Err(AppError::Message(
        "当前实现仅支持 macOS Terminal 接管能力".into(),
    ))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::build_terminal_shell_command;

    #[cfg(target_os = "macos")]
    use super::{build_open_in_finder_command, build_open_in_terminal_command};

    #[test]
    #[cfg(target_os = "macos")]
    fn builds_macos_open_command_for_directory() {
        let (program, args) = build_open_in_finder_command(Path::new("/tmp/demo"), false)
            .expect("构建 open 命令失败");

        assert_eq!(program, "open");
        assert_eq!(args, vec!["/tmp/demo"]);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn builds_macos_open_command_for_reveal() {
        let (program, args) = build_open_in_finder_command(Path::new("/tmp/demo.txt"), true)
            .expect("构建 reveal 命令失败");

        assert_eq!(program, "open");
        assert_eq!(args, vec!["-R", "/tmp/demo.txt"]);
    }

    #[test]
    fn builds_shell_command_with_directory() {
        let command = build_terminal_shell_command("hermes setup", Some(Path::new("/tmp/demo")));

        assert_eq!(command, "cd '/tmp/demo' && hermes setup");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn builds_macos_terminal_command() {
        let (program, args) =
            build_open_in_terminal_command("hermes setup", Some(Path::new("/tmp/demo")))
                .expect("构建 Terminal 命令失败");

        assert_eq!(program, "osascript");
        assert!(args
            .iter()
            .any(|arg| arg == "tell application \"Terminal\""));
        assert_eq!(args.last().map(String::as_str), Some("/tmp/demo"));
        assert!(args.iter().any(|arg| arg == "hermes setup"));
    }
}
