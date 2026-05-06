import { execFile, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession } from '@shared/types';

const EDITOR_CANDIDATES = [
  ['code.cmd', 'code.exe'],
  ['cursor.cmd', 'cursor.exe'],
  ['windsurf.cmd', 'windsurf.exe'],
  ['trae.cmd', 'trae.exe'],
  ['idea.cmd', 'idea64.exe'],
  ['webstorm.cmd', 'webstorm64.exe'],
  ['pycharm.cmd', 'pycharm64.exe'],
  ['goland.cmd', 'goland64.exe'],
  ['clion.cmd', 'clion64.exe'],
  ['Rider.cmd', 'rider64.exe']
];

export async function jumpToWorkspace(workspace?: string): Promise<{ ok: boolean; message: string }> {
  if (!workspace) return { ok: false, message: 'No workspace is associated with this session.' };
  if (!pathExists(workspace)) return { ok: false, message: `Workspace path was not found: ${workspace}` };
  const command = findFirstCommand(EDITOR_CANDIDATES.flat());
  if (!command) return { ok: false, message: 'No supported editor command found in PATH.' };
  const args = /(?:code|cursor|windsurf|trae)\.(?:cmd|exe)$/i.test(command) ? ['-r', workspace] : [workspace];
  await exec(command, args);
  return { ok: true, message: `Opened ${workspace}` };
}

export async function focusWindowsTerminal(workspace?: string): Promise<{ ok: boolean; message: string }> {
  if (workspace && !pathExists(workspace)) return { ok: false, message: `Workspace path was not found: ${workspace}` };
  const wt = findFirstCommand(['wt.exe']);
  if (!wt) return { ok: false, message: 'Windows Terminal was not found.' };
  await exec(wt, workspace ? ['-d', workspace] : []);
  return { ok: true, message: 'Windows Terminal focused or opened.' };
}

export async function preciseJump(workspace?: string): Promise<{ ok: boolean; message: string }> {
  if (workspace) {
    const terminal = await focusWindowsTerminal(workspace);
    if (terminal.ok) return { ok: true, message: `Opened Windows Terminal in ${workspace}` };
  }
  return jumpToWorkspace(workspace);
}

export async function jumpToTerminalSession(session?: AgentSession): Promise<{ ok: boolean; message: string }> {
  const terminal = session?.metadata?.terminal;
  const parentPid = terminal && typeof terminal === 'object' ? numberValue(terminal.parentPid) : undefined;
  if (!parentPid) {
    return { ok: false, message: '跳转失败：当前会话没有可定位的终端信息。' };
  }

  const focused = await focusProcessTreeWindow(parentPid);
  if (focused.ok) return focused;
  return { ok: false, message: '跳转失败：没有找到这个会话的终端窗口。' };
}

function findFirstCommand(candidates: string[]): string | undefined {
  const pathEnv = process.env.PATH ?? '';
  for (const directory of pathEnv.split(';')) {
    for (const candidate of candidates) {
      const fullPath = join(directory, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }
  return undefined;
}

function exec(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (/\.cmd$/i.test(file)) {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', file, ...args], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.once('error', reject);
      child.unref();
      resolve();
      return;
    }

    const child = execFile(file, args, { windowsHide: true }, (error) => (error ? reject(error) : resolve()));
    child.unref();
  });
}

function focusProcessTreeWindow(pid: number): Promise<{ ok: boolean; message: string }> {
  const script = `
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class Win32Focus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null
$pidValue = ${pid}
$visited = @{}
while ($pidValue -and -not $visited.ContainsKey($pidValue)) {
  $visited[$pidValue] = $true
  $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne 0) {
    [Win32Focus]::ShowWindowAsync($proc.MainWindowHandle, 9) | Out-Null
    [Win32Focus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Write-Output "focused:$($proc.ProcessName):$($proc.Id)"
    exit 0
  }
  $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
  if (-not $cim) { break }
  $pidValue = $cim.ParentProcessId
}
Write-Output "not-found"
exit 2
`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true }, (error, stdout) => {
      const output = String(stdout).trim();
      if (!error && output.startsWith('focused:')) {
        resolve({ ok: true, message: `已跳转到终端窗口：${output.slice('focused:'.length)}` });
        return;
      }
      resolve({ ok: false, message: '跳转失败：没有找到这个会话的终端窗口。' });
    });
  });
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function pathExists(path: string): boolean {
  try {
    const info = statSync(path);
    return info.isDirectory() || info.isFile();
  } catch {
    return false;
  }
}

