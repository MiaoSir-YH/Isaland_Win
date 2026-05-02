import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const EDITOR_CANDIDATES = [
  ['code.cmd', 'code.exe'],
  ['windsurf.cmd', 'windsurf.exe'],
  ['idea.cmd', 'idea64.exe'],
  ['Rider.cmd', 'rider64.exe']
];

export async function jumpToWorkspace(workspace?: string): Promise<{ ok: boolean; message: string }> {
  if (!workspace) return { ok: false, message: 'No workspace is associated with this session.' };
  const command = findFirstCommand(EDITOR_CANDIDATES.flat());
  if (!command) return { ok: false, message: 'No supported editor command found in PATH.' };
  await exec(command, [workspace]);
  return { ok: true, message: `Opened ${workspace}` };
}

export async function focusWindowsTerminal(): Promise<{ ok: boolean; message: string }> {
  const wt = findFirstCommand(['wt.exe']);
  if (!wt) return { ok: false, message: 'Windows Terminal was not found.' };
  await exec(wt, []);
  return { ok: true, message: 'Windows Terminal focused or opened.' };
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
    const child = execFile(file, args, { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.unref();
  });
}

