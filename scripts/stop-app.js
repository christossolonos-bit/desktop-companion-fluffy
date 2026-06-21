const fs = require('fs');
const path = require('path');
const { root, findElectronPids, isProcessRunning, killPid, killXttsPlayer } = require('./process-utils');

const pidFile = path.join(root, '.viewer.pid');

function clearPidFile() {
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

function collectPids() {
  const fromFile = fs.existsSync(pidFile)
    ? fs.readFileSync(pidFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid))
    : [];

  return [...new Set([...fromFile, ...findElectronPids()])];
}

const pids = collectPids().filter((pid) => isProcessRunning(pid));

if (pids.length === 0) {
  clearPidFile();
  console.log('Live2D Viewer is not running.');
  process.exit(0);
}

for (const pid of pids) {
  killPid(pid);
}

const xttsPids = killXttsPlayer();

clearPidFile();
if (xttsPids.length > 0) {
  console.log(`XTTS player closed (PID ${xttsPids.join(', ')}).`);
}
console.log(`Live2D Viewer closed (PID ${pids.join(', ')}).`);
