const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('live2dViewer', {
  openModelDialog: () => ipcRenderer.invoke('dialog:open-model'),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:set-always-on-top', enabled),
  setIgnoreMouse: (ignore, forward) => ipcRenderer.invoke('window:set-ignore-mouse', ignore, forward),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  setAvatarPlacement: (position) => ipcRenderer.invoke('settings:set-avatar-placement', position),
  getAvatarPlacement: () => ipcRenderer.invoke('settings:get-avatar-placement'),
  getStartupModel: () => ipcRenderer.invoke('app:get-startup-model'),
  ollamaChat: (messages, options) => ipcRenderer.invoke('ollama:chat', messages, options),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  transcribeAudio: (wavBytes) => ipcRenderer.invoke('whisper:transcribe', wavBytes),
  whisperStatus: () => ipcRenderer.invoke('whisper:status'),
  speakText: (text) => ipcRenderer.invoke('xtts:speak', text),
  stopSpeak: () => ipcRenderer.invoke('xtts:stop'),
  xttsStatus: () => ipcRenderer.invoke('xtts:status'),
  getScreenContext: () => ipcRenderer.invoke('screen-context:get'),
  getMediaContext: () => ipcRenderer.invoke('media-context:get'),
});
