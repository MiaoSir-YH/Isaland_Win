import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../src/main/index.ts'), 'utf8');
const rendererSource = readFileSync(resolve(__dirname, '../src/renderer/src/App.tsx'), 'utf8');
const rendererStyles = readFileSync(resolve(__dirname, '../src/renderer/src/styles.css'), 'utf8');

describe('island window behavior guardrails', () => {
  test('does not animate native window bounds with a timer', () => {
    expect(mainSource).not.toContain('animateIslandBounds');
    expect(mainSource).not.toContain('islandPositionTimer');
    expect(mainSource).not.toMatch(/setInterval\([^)]*setBounds/s);
  });

  test('keeps the native island window anchored on screen while peeking', () => {
    const getCanvasBounds = mainSource.match(/function getIslandCanvasBounds\(\): Electron\.Rectangle \{([\s\S]*?)\n\}/);

    expect(getCanvasBounds?.[1]).toContain('display.workArea.y + ISLAND_TOP_OFFSET');
    expect(getCanvasBounds?.[1]).not.toContain('islandPeeking');
    expect(getCanvasBounds?.[1]).not.toMatch(/display\.workArea\.y\s*-/);
  });

  test('reapplies topmost after native bounds changes without expensive z-order forcing', () => {
    const positionIsland = mainSource.match(/function positionIsland\(\): void \{([\s\S]*?)\n\}/);
    const ensureTopmost = mainSource.match(/function ensureIslandAlwaysOnTop\(\): void \{([\s\S]*?)\n\}/);

    expect(positionIsland?.[1]).toMatch(/setBounds\([\s\S]*ensureIslandAlwaysOnTop\(\);/);
    expect(ensureTopmost?.[1]).toContain('setAlwaysOnTop(true)');
    expect(ensureTopmost?.[1]).not.toContain('isAlwaysOnTop()');
    expect(ensureTopmost?.[1]).not.toContain('moveTop');
    expect(ensureTopmost?.[1]).not.toContain('setVisibleOnAllWorkspaces');
    expect(ensureTopmost?.[1]).not.toContain('screen-saver');
  });

  test('renders the peek ball by offsetting the visual inside the on-screen window', () => {
    expect(rendererStyles).toContain('--island-peek-visible-height');
    expect(rendererStyles).toContain('--island-peek-offset');
    expect(mainSource).toContain('const ISLAND_TOP_OFFSET = 0');
    expect(rendererStyles).toContain('--island-window-top-offset: 0px');
    expect(rendererStyles).toContain('--island-peek-visible-height: 12px');
    expect(rendererStyles).toMatch(/\.island-card\.peek-peeking[\s\S]*transform:\s*translateY\(var\(--island-peek-offset\)\)/);
  });

  test('restores the renderer from any pending peek phase when the native window is shown', () => {
    const restoreIslandBar = rendererSource.match(/const restoreIslandBar = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/);

    expect(restoreIslandBar?.[1]).toContain('clearPeekTransitionTimer();');
    expect(restoreIslandBar?.[1]).toContain('peekingRef.current = false;');
    expect(restoreIslandBar?.[1]).not.toContain('return;');
  });
});
