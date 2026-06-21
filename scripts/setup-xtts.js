const { execFileSync } = require('child_process');

const XTTS_PYTHON = process.env.XTTS_PYTHON || 'py';
const XTTS_PYTHON_ARGS = process.env.XTTS_PYTHON ? [] : ['-3.11'];
const USE_CPU = process.env.XTTS_CPU === '1';

function runPip(args) {
  execFileSync(XTTS_PYTHON, [...XTTS_PYTHON_ARGS, '-m', 'pip', ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
}

function main() {
  try {
    execFileSync(XTTS_PYTHON, [...XTTS_PYTHON_ARGS, '--version'], {
      stdio: 'inherit',
      windowsHide: true,
    });
  } catch {
    console.error('Python 3.11 not found. Install Python 3.11 or set XTTS_PYTHON.');
    process.exitCode = 1;
    return;
  }

  try {
    if (USE_CPU) {
      runPip(['uninstall', '-y', 'torch', 'torchaudio']);
      runPip([
        'install',
        'torch==2.5.1',
        'torchaudio==2.5.1',
        '--index-url',
        'https://download.pytorch.org/whl/cpu',
      ]);
      console.log('Coqui XTTS installed (Python 3.11, PyTorch 2.5 CPU).');
    } else {
      runPip(['uninstall', '-y', 'torch', 'torchaudio']);
      runPip([
        'install',
        'torch==2.5.1',
        'torchaudio==2.5.1',
        '--index-url',
        'https://download.pytorch.org/whl/cu124',
      ]);
      console.log('Coqui XTTS installed (Python 3.11, PyTorch 2.5 CUDA 12.4).');
    }

    runPip(['install', 'coqui-tts', 'transformers==5.0.0', 'pygame', 'mutagen']);
    runPip(['uninstall', '-y', 'torchcodec']);
    console.log('Voice reference: Serafina - Sensual Temptress_pvc_sp92_s31_sb81_v3.mp3');
    console.log('XTTS will use CUDA when available (set XTTS_CPU=1 for CPU-only install).');
  } catch (error) {
    console.error('Failed to install XTTS dependencies:', error.message);
    process.exitCode = 1;
  }
}

main();
