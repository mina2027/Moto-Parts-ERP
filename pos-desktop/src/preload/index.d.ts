import type { PosApi } from '../shared/ipc';
import type { DisplayApi } from '../shared/display';

declare global {
  interface Window {
    pos: PosApi;
    posDisplay: DisplayApi;
  }
}

export {};
