const fs = require('fs');
const path = require('path');
const { root, findElectronPids, isProcessRunning } = require('./process-utils');

const pidFile = path.join(root, '.viewer.pid');

const fromFile = fs.existsSync(pidFile)
  ? fs.readFileSync(pidFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isFinite(pid))
  : [];

const pids = [...new Set([...fromFile, ...findElectronPids()])].filter((pid) => isProcessRunning(pid));

if (pids.length === 0) {
  console.log('Live2D Viewer is not running.');
  process.exit(1);
}

console.log(`Live2D Viewer is running (PID ${pids.join(', ')}).`);
