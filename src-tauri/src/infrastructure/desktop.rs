use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{AppError, AppResult};
use crate::models::{CommandRunResult, DesktopOpenRequest};

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

#[cfg(target_os = "macos")]
fn build_open_in_finder_command(path: &Path, reveal_in_finder: bool) -> AppResult<(String, Vec<String>)> {
    let mut args = Vec::new();
    if reveal_in_finder {
        args.push("-R".to_string());
    }
    args.push(path.display().to_string());
    Ok(("open".to_string(), args))
}

#[cfg(not(target_os = "macos"))]
fn build_open_in_finder_command(_path: &Path, _reveal_in_finder: bool) -> AppResult<(String, Vec<String>)> {
    Err(AppError::Message(
        "当前实现仅支持 macOS Finder 打开能力".into(),
    ))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::build_open_in_finder_command;

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
}
