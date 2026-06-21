const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const projectMarker = path.basename(root);

function findElectronPids() {
  if (process.platform === 'win32') {
    try {
      const psCommand = [
        'Get-CimInstance Win32_Process',
        "| Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*" + projectMarker + "*' }",
        '| Select-Object -ExpandProperty ProcessId',
      ].join(' ');

      const output = execSync(`powershell -NoProfile -Command ${JSON.stringify(psCommand)}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      return output
        .split(/\r?\n/)
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isFinite(pid));
    } catch {
      return [];
    }
  }

  try {
    const output = execSync(`pgrep -f "${root}"`, { encoding: 'utf8' });
    return output
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid));
  } catch {
    return [];
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

function findXttsPlayerPids(port = 17351) {
  if (process.platform === 'win32') {
    try {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = new Set();
      const needle = `:${port}`;

      for (const line of output.split(/\r?\n/)) {
        if (!line.includes(needle) || !line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number.parseInt(parts[parts.length - 1], 10);
        if (Number.isFinite(pid)) pids.add(pid);
      }

      return [...pids];
    } catch {
      return [];
    }
  }

  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' });
    return output
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid));
  } catch {
    return [];
  }
}

function killXttsPlayer(port = 17351) {
  const pids = findXttsPlayerPids(port).filter((pid) => isProcessRunning(pid));
  for (const pid of pids) {
    killPid(pid);
  }
  return pids;
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // brief wait for Electron to spawn on Windows
  }
}

module.exports = {
  root,
  findElectronPids,
  isProcessRunning,
  killPid,
  killXttsPlayer,
  sleep,
};
