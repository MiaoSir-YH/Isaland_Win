/// <reference types="vite/client" />

import type { VibeIslandApi } from '../../preload';

declare global {
  interface Window {
    vibeIsland: VibeIslandApi;
  }
}
