const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base.en';
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'whisper-transcribe.py');

let cachedPython = null;

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

  const candidates = [
    ['python', ['--version']],
    ['python3', ['--version']],
    ['py', ['-3', '--version']],
  ];

  for (const [command, args] of candidates) {
    const found = await probePython(command, args);
    if (found) {
      cachedPython = { command: found, prefixArgs: found === 'py' ? ['-3'] : [] };
      return cachedPython;
    }
  }

  throw new Error('Python 3 not found. Install Python, then run: pip install faster-whisper');
}

async function checkWhisper() {
  try {
    const python = await findPython();
    const args = [...python.prefixArgs, '-c', 'import faster_whisper; print("ok")'];
    const { stdout } = await execFileAsync(python.command, args, { windowsHide: true });
    return {
      ok: stdout.includes('ok'),
      model: WHISPER_MODEL,
      python: python.command,
    };
  } catch (error) {
    return {
      ok: false,
      error: 'Install faster-whisper: pip install faster-whisper',
      detail: error.message,
      model: WHISPER_MODEL,
    };
  }
}

async function transcribeWavBuffer(buffer) {
  const python = await findPython();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'live2d-whisper-'));
  const wavPath = path.join(tempDir, 'audio.wav');

  try {
    await fs.writeFile(wavPath, buffer);
    const args = [...python.prefixArgs, SCRIPT_PATH, wavPath, '--model', WHISPER_MODEL];
    const { stdout } = await execFileAsync(python.command, args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    const result = JSON.parse(stdout.trim());
    if (!result.ok) {
      throw new Error(result.error || 'Whisper transcription failed.');
    }

    return {
      ok: true,
      text: result.text || '',
      model: WHISPER_MODEL,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  WHISPER_MODEL,
  checkWhisper,
  transcribeWavBuffer,
};
