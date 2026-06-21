const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { root, findElectronPids, isProcessRunning, sleep } = require('./process-utils');

const pidFile = path.join(root, '.viewer.pid');
const distIndex = path.join(root, 'dist', 'index.html');
const electronBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(root, 'node_modules', '.bin', 'electron');

function writePidFile(pids) {
  fs.writeFileSync(pidFile, pids.join('\n'), 'utf8');
}

function clearPidFile() {
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

function getRunningPids() {
  const fromFile = fs.existsSync(pidFile)
    ? fs.readFileSync(pidFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && isProcessRunning(pid))
    : [];

  return [...new Set([...fromFile, ...findElectronPids()])];
}

const running = getRunningPids();
if (running.length > 0) {
  console.log(`Live2D Viewer is already running (PID ${running.join(', ')}).`);
  console.log('Run "npm run app:stop" to close it first.');
  process.exit(1);
}

clearPidFile();

if (!fs.existsSync(distIndex)) {
  console.log('Building renderer (first run)…');
  execSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
}

spawn(electronBin, ['.'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
}).unref();

sleep(2000);

const pids = findElectronPids();
if (pids.length === 0) {
  console.log('Live2D Viewer launch requested, but no Electron process was detected.');
  console.log('Try: npm start');
  process.exit(1);
}

writePidFile(pids);
console.log(`Live2D Viewer started (PID ${pids.join(', ')}).`);
console.log('Close with: npm run app:stop');
