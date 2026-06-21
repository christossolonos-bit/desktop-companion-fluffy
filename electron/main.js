const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const ollama = require('./ollama');
const whisper = require('./whisper');
const xtts = require('./xtts');
const screenContext = require('./screen-context');
const mediaContext = require('./media-context');

const isDev = process.env.ELECTRON_DEV === '1';
let mainWindow = null;

const DEFAULT_MODEL_DIR = path.join(__dirname, '..', 'tuzi_mian__2_');

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');

async function readSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_PATH(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeSettings(partial) {
  const current = await readSettings();
  await fs.writeFile(
    SETTINGS_PATH(),
    JSON.stringify({ ...current, ...partial }, null, 2),
    'utf8',
  );
}

async function findModelSettingsFile(targetPath) {
  const stat = await fs.stat(targetPath);

  if (stat.isFile()) {
    const lower = targetPath.toLowerCase();
    if (lower.endsWith('.model3.json') || lower.endsWith('.model.json')) {
      return targetPath;
    }
    throw new Error('Selected file is not a Live2D model settings file (.model3.json or .model.json).');
  }

  const matches = await collectModelSettingsFiles(targetPath);
  if (matches.length === 0) {
    throw new Error('No .model3.json or .model.json file found in the selected folder (searched subfolders too).');
  }

  return pickBestModelSettings(matches);
}

async function collectModelSettingsFiles(dir, depth = 0, maxDepth = 5, results = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.model3.json') || lower.endsWith('.model.json')) {
      results.push({
        path: path.join(dir, entry.name),
        depth,
        isModel3: lower.endsWith('.model3.json'),
      });
    }
  }

  if (depth >= maxDepth) {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    await collectModelSettingsFiles(path.join(dir, entry.name), depth + 1, maxDepth, results);
  }

  return results;
}

function pickBestModelSettings(matches) {
  return matches.sort((a, b) => {
    if (a.isModel3 !== b.isModel3) return a.isModel3 ? -1 : 1;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.path.localeCompare(b.path);
  })[0].path;
}

async function validateModelAssets(modelFilePath) {
  const raw = await fs.readFile(modelFilePath, 'utf8');
  const settings = JSON.parse(raw);
  const refs = settings.FileReferences;
  if (!refs?.Moc) {
    throw new Error('Model JSON is missing a Moc file reference.');
  }

  const dir = path.dirname(modelFilePath);
  const missing = [];

  try {
    await fs.access(path.join(dir, refs.Moc));
  } catch {
    missing.push(refs.Moc);
  }

  for (const texture of refs.Textures ?? []) {
    try {
      await fs.access(path.join(dir, texture));
    } catch {
      missing.push(texture);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Model files missing from folder:\n${missing.map((file) => `• ${file}`).join('\n')}\n\nCopy the full model export (.moc3 + textures) into the model folder.`,
    );
  }
}

async function resolveStartupModelUrl() {
  const settings = await readSettings();

  if (settings.lastModelPath) {
    try {
      await fs.access(settings.lastModelPath);
      const modelFile = await findModelSettingsFile(settings.lastModelPath);
      await validateModelAssets(modelFile);
      return pathToFileURL(modelFile).href;
    } catch {
      // Fall back to bundled default model.
    }
  }

  const modelFile = await findModelSettingsFile(DEFAULT_MODEL_DIR);
  await validateModelAssets(modelFile);
  return pathToFileURL(modelFile).href;
}

function applyOverlayBounds(win) {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  win.setBounds({ x, y, width, height });
  win.setResizable(false);
  win.setMaximizable(false);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    applyOverlayBounds(mainWindow);
    mainWindow.setBackgroundColor('#00000000');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture' || permission === 'microphone');
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'audioCapture' || permission === 'microphone';
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  xtts.shutdown();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:get-startup-model', async () => {
  try {
    const modelUrl = await resolveStartupModelUrl();
    return { ok: true, modelUrl };
  } catch (error) {
    return { ok: false, error: error.message || 'Failed to resolve startup model.' };
  }
});

ipcMain.handle('dialog:open-model', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Live2D Model',
      properties: ['openFile', 'openDirectory'],
      filters: [
        { name: 'Live2D Model', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: true, modelUrl: null };
    }

    const selected = result.filePaths[0];
    const modelFile = await findModelSettingsFile(selected);
    await validateModelAssets(modelFile);
    await writeSettings({ lastModelPath: selected });

    return { ok: true, modelUrl: pathToFileURL(modelFile).href };
  } catch (error) {
    return { ok: false, error: error.message || 'Failed to open model.' };
  }
});

ipcMain.handle('window:set-always-on-top', (_event, enabled) => {
  mainWindow?.setAlwaysOnTop(Boolean(enabled));
});

ipcMain.handle('window:set-ignore-mouse', (_event, ignore, forward = true) => {
  mainWindow?.setIgnoreMouseEvents(Boolean(ignore), { forward: Boolean(forward) });
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.on('window:drag', () => {
  // Frameless drag is handled in the renderer via -webkit-app-region.
});

ipcMain.handle('settings:set-avatar-placement', async (_event, position) => {
  await writeSettings({ avatarPlacement: position });
});

ipcMain.handle('settings:get-avatar-placement', async () => {
  const settings = await readSettings();
  if (settings.avatarPlacement) {
    return settings.avatarPlacement;
  }
  if (settings.dockPosition) {
    return settings.dockPosition;
  }
  return null;
});

ipcMain.handle('ollama:chat', async (_event, messages, options) => {
  try {
    return await ollama.chat(messages, options);
  } catch (error) {
    return { ok: false, error: error.message || 'Ollama chat failed.' };
  }
});

ipcMain.handle('ollama:status', async () => ollama.status());

ipcMain.handle('whisper:transcribe', async (_event, audioBuffer) => {
  try {
    const buffer = Buffer.from(audioBuffer);
    return await whisper.transcribeWavBuffer(buffer);
  } catch (error) {
    return { ok: false, error: error.message || 'Whisper transcription failed.' };
  }
});

ipcMain.handle('whisper:status', async () => whisper.checkWhisper());

ipcMain.handle('xtts:speak', async (_event, text) => {
  try {
    return await xtts.speak(text);
  } catch (error) {
    return { ok: false, error: error.message || 'XTTS synthesis failed.' };
  }
});

ipcMain.handle('xtts:stop', async () => xtts.stop());

ipcMain.handle('xtts:status', async () => xtts.checkXtts());

ipcMain.handle('screen-context:get', async () => screenContext.getScreenContext());

ipcMain.handle('media-context:get', async () => mediaContext.getMediaContext());

ipcMain.handle('shell:open-external', (_event, url) => {
  return shell.openExternal(url);
});
