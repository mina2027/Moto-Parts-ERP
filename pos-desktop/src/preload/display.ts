import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { DisplayApi, DisplayState } from '../shared/display';

const display: DisplayApi = {
  settings: () => ipcRenderer.invoke(IPC.displaySettings),
  onState(cb) {
    const listener = (_event: Electron.IpcRendererEvent, state: DisplayState) => cb(state);
    ipcRenderer.on(IPC.evDisplayState, listener);
    return () => ipcRenderer.removeListener(IPC.evDisplayState, listener);
  },
};
export function exposeDisplayBridge() {
  contextBridge.exposeInMainWorld('posDisplay', display);
}
