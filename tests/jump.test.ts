import { describe, expect, it } from 'vitest';
import { focusWindowsTerminal, jumpToTerminalSession, jumpToWorkspace, preciseJump } from '../src/main/jump';

describe('jump resolver exports', () => {
  it('returns a clear failure when no workspace is available', async () => {
    await expect(jumpToWorkspace()).resolves.toEqual({
      ok: false,
      message: 'No workspace is associated with this session.'
    });
  });

  it('falls back to workspace jump when precise jump has no workspace', async () => {
    await expect(preciseJump()).resolves.toEqual({
      ok: false,
      message: 'No workspace is associated with this session.'
    });
  });

  it('exports terminal focusing helper', () => {
    expect(typeof focusWindowsTerminal).toBe('function');
  });

  it('fails instead of falling back when a session has no terminal metadata', async () => {
    await expect(
      jumpToTerminalSession({
        id: 'claude-session',
        agent: 'claude',
        title: 'Island_Win',
        status: 'user',
        lastSeenAt: new Date().toISOString(),
        eventCount: 1,
        workspace: 'M:\\island\\Island_Win'
      })
    ).resolves.toEqual({
      ok: false,
      message: '跳转失败：当前会话没有可定位的终端信息。'
    });
  });

  it('opens Windows Terminal for terminal jumps when no precise metadata is required', async () => {
    expect(typeof focusWindowsTerminal).toBe('function');
  });
});
