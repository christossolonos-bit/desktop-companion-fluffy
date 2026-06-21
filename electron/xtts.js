const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const PLAYER_SCRIPT = path.join(__dirname, '..', 'scripts', 'xtts-player.py');
const SPEAKER_WAV = process.env.XTTS_SPEAKER_WAV
  || path.join(__dirname, '..', 'Serafina - Sensual Temptress_pvc_sp92_s31_sb81_v3.mp3');
const XTTS_MODEL = process.env.XTTS_MODEL || 'tts_models/multilingual/multi-dataset/xtts_v2';
const PLAYER_PORT = parseInt(process.env.XTTS_PLAYER_PORT || '17351', 10);
const STARTUP_TIMEOUT_MS = 10 * 60 * 1000;

let cachedPython = null;
let playerProcess = null;
let playerStarting = null;

async function probePython(command, args = ['--version']) {
  try {
    await execFileAsync(command, args, { windowsHide: true });
    return command;
  } catch {
    return null;
  }
}

async function findPython() {
  if (cachedPython) return cachedPython;

  if (process.env.XTTS_PYTHON) {
    cachedPython = { command: process.env.XTTS_PYTHON, prefixArgs: [] };
    return cachedPython;
  }

  const candidates = [
    { command: 'py', prefixArgs: ['-3.11'], probeArgs: ['-3.11', '--version'] },
    { command: 'py', prefixArgs: ['-3.12'], probeArgs: ['-3.12', '--version'] },
    { command: 'python', prefixArgs: [], probeArgs: ['--version'] },
    { command: 'python3', prefixArgs: [], probeArgs: ['--version'] },
  ];

  for (const candidate of candidates) {
    const found = await probePython(candidate.command, candidate.probeArgs);
    if (found) {
      cachedPython = { command: found, prefixArgs: candidate.prefixArgs };
      return cachedPython;
    }
  }

  throw new Error('Python 3.11+ not found. Run: npm run setup:xtts');
}

function tcpRequest(payload, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port: PLAYER_PORT }, () => {
      client.write(JSON.stringify(payload));
      client.end();
    });

    let data = '';
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('XTTS player request timed out.'));
    }, timeoutMs);

    client.on('data', (chunk) => {
      data += chunk.toString();
    });

    client.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (error) {
        reject(new Error('Invalid response from XTTS player.'));
      }
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function pingPlayer() {
  try {
    const result = await tcpRequest({ cmd: 'ping' }, 3000);
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

async function ensurePlayer() {
  if (await pingPlayer()) return;

  if (playerStarting) {
    await playerStarting;
    return;
  }

  playerStarting = (async () => {
    await fs.access(SPEAKER_WAV);
    const python = await findPython();

    playerProcess = spawn(
      python.command,
      [...python.prefixArgs, PLAYER_SCRIPT],
      {
        stdio: 'ignore',
        windowsHide: false,
        detached: false,
        env: {
          ...process.env,
          XTTS_MODEL,
          XTTS_SPEAKER_WAV: SPEAKER_WAV,
          XTTS_PLAYER_PORT: String(PLAYER_PORT),
          XTTS_GPU: process.env.XTTS_GPU ?? '1',
          PYTHONUNBUFFERED: '1',
        },
      },
    );

    playerProcess.on('exit', () => {
      playerProcess = null;
    });

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await tcpRequest({ cmd: 'ping' }, 3000).catch(() => null);
      if (result?.ok && result?.ready) return;
      if (result?.ok && !result?.ready) {
        await new Promise((resolve) => { setTimeout(resolve, 2000); });
        continue;
      }
      await new Promise((resolve) => { setTimeout(resolve, 1000); });
    }

    throw new Error('XTTS player startup timed out (model may still be downloading).');
  })();

  try {
    await playerStarting;
  } finally {
    playerStarting = null;
  }
}

async function speak(text) {
  const trimmed = text?.trim();
  if (!trimmed) {
    return { ok: false, error: 'Empty text.' };
  }

  await ensurePlayer();
  return tcpRequest({ cmd: 'speak', text: trimmed });
}

async function stop() {
  try {
    return await tcpRequest({ cmd: 'stop' }, 3000);
  } catch {
    return { ok: false };
  }
}

async function checkXtts() {
  try {
    await fs.access(SPEAKER_WAV);
    const python = await findPython();
    const args = [...python.prefixArgs, '-c', 'import pygame; from TTS.api import TTS; print("ok")'];
    const { stdout } = await execFileAsync(python.command, args, { windowsHide: true });

    return {
      ok: stdout.includes('ok'),
      model: XTTS_MODEL,
      speaker: path.basename(SPEAKER_WAV),
      python: python.command,
      playerPort: PLAYER_PORT,
      cuda: process.env.XTTS_GPU !== '0',
    };
  } catch (error) {
    return {
      ok: false,
      error: 'Install Coqui XTTS: npm run setup:xtts',
      detail: error.message,
      model: XTTS_MODEL,
      speaker: path.basename(SPEAKER_WAV),
    };
  }
}

function shutdown() {
  tcpRequest({ cmd: 'shutdown' }, 3000).catch(() => {});

  if (!playerProcess) return;

  try {
    playerProcess.kill();
  } catch {
    // ignore
  }

  playerProcess = null;
}

module.exports = {
  SPEAKER_WAV,
  XTTS_MODEL,
  PLAYER_PORT,
  speak,
  stop,
  checkXtts,
  shutdown,
};
