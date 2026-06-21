const { execFileSync } = require('child_process');

function findPython() {
  for (const command of ['python', 'python3', 'py']) {
    try {
      const args = command === 'py' ? ['-3', '--version'] : ['--version'];
      execFileSync(command, args, { stdio: 'ignore', windowsHide: true });
      return command;
    } catch {
      // try next
    }
  }
  return null;
}

function main() {
  const python = findPython();
  if (!python) {
    console.error('Python 3 not found. Install Python from https://python.org');
    process.exitCode = 1;
    return;
  }

  const prefix = python === 'py' ? ['-3'] : [];
  try {
    execFileSync(python, [...prefix, '-m', 'pip', 'install', 'faster-whisper'], {
      stdio: 'inherit',
      windowsHide: true,
    });
    console.log('faster-whisper installed. Default model: base.en (fast CPU mode).');
  } catch (error) {
    console.error('Failed to install faster-whisper:', error.message);
    process.exitCode = 1;
  }
}

main();
