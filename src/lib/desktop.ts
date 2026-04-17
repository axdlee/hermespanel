import { api } from './api';
import type { CommandRunResult, NoticeTone } from '../types';

export type CommandScope = 'global' | 'profile';
export type NotifyHandler = (tone: NoticeTone, message: string) => void;
export type BusyHandler = (actionKey: string | null) => void;
export type ResultHandler = (label: string, result: CommandRunResult) => void;

interface DesktopActionBase {
  actionKey?: string;
  notify: NotifyHandler;
  onResult?: ResultHandler;
  setBusy?: BusyHandler;
}

interface FinderActionOptions extends DesktopActionBase {
  label: string;
  path: string;
  revealInFinder?: boolean;
}

interface TerminalActionOptions extends DesktopActionBase {
  profile: string;
  label: string;
  command: string;
  scope?: CommandScope;
  workingDirectory?: string | null;
  confirmMessage?: string;
}

export function resolveScopedCommand(
  command: string,
  profile: string,
  scope: CommandScope = 'profile'
) {
  if (scope === 'global' || profile === 'default' || !command.startsWith('hermes ')) {
    return command;
  }

  return command.replace(/^hermes\b/, `hermes -p ${profile}`);
}

export async function openFinderLocation(options: FinderActionOptions) {
  options.setBusy?.(options.actionKey ?? 'finder');
  try {
    const result = await api.openInFinder({
      path: options.path,
      revealInFinder: options.revealInFinder ?? false,
    });
    options.onResult?.(options.label, result);
    options.notify(
      result.success ? 'success' : 'error',
      result.success
        ? `${options.label} 已在 Finder 中打开。`
        : `${options.label} 打开失败，请检查命令输出。`
    );
    return result;
  } catch (reason) {
    options.notify('error', String(reason));
    return null;
  } finally {
    options.setBusy?.(null);
  }
}

export async function handoffToTerminal(options: TerminalActionOptions) {
  if (options.confirmMessage && !window.confirm(options.confirmMessage)) {
    return null;
  }

  const actionKey = options.actionKey ?? `terminal:${options.label}`;
  const finalCommand = resolveScopedCommand(
    options.command,
    options.profile,
    options.scope ?? 'profile'
  );

  options.setBusy?.(actionKey);
  try {
    const result = await api.openInTerminal({
      command: finalCommand,
      workingDirectory: options.workingDirectory ?? null,
    });
    options.onResult?.(options.label, result);
    options.notify(
      result.success ? 'success' : 'error',
      result.success
        ? `${options.label} 已交给 Terminal 执行，完成后回到面板刷新即可。`
        : `${options.label} 打开 Terminal 失败，请检查系统权限或命令路径。`
    );
    return result;
  } catch (reason) {
    options.notify('error', String(reason));
    return null;
  } finally {
    options.setBusy?.(null);
  }
}
