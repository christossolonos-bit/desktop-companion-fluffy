const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const APP_TITLE_HINTS = ['live2d model viewer', 'live2d viewer'];

const PS_SCRIPT = String.raw`
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FluffyScreenCtx {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@ -ErrorAction Stop

$active = ''
$handle = [FluffyScreenCtx]::GetForegroundWindow()
$builder = New-Object System.Text.StringBuilder 512
[void][FluffyScreenCtx]::GetWindowText($handle, $builder, 512)
$active = $builder.ToString().Trim()

$others = @(
  Get-Process |
    Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim() } |
    ForEach-Object { $_.MainWindowTitle.Trim() } |
    Where-Object { $_ -and $_ -ne $active } |
    Select-Object -Unique |
    Select-Object -First 6
)

[PSCustomObject]@{
  activeWindow = $active
  otherWindows = @($others)
} | ConvertTo-Json -Compress
`;

function normalizeTitle(title) {
  return title?.trim().replace(/\s+/g, ' ') ?? '';
}

function isNoiseTitle(title) {
  const lower = title.toLowerCase();
  if (!title) return true;
  if (lower === 'program manager') return true;
  if (lower === 'settings') return true;
  return false;
}

function isOwnAppTitle(title) {
  const lower = title.toLowerCase();
  return APP_TITLE_HINTS.some((hint) => lower.includes(hint));
}

function parsePayload(stdout) {
  const data = JSON.parse(stdout.trim());
  const activeWindow = normalizeTitle(data.activeWindow);
  const otherWindows = (Array.isArray(data.otherWindows) ? data.otherWindows : [])
    .map(normalizeTitle)
    .filter((title) => title && !isNoiseTitle(title) && title !== activeWindow);

  return {
    ok: true,
    activeWindow: isNoiseTitle(activeWindow) ? '' : activeWindow,
    activeWindowIsSelf: isOwnAppTitle(activeWindow),
    otherWindows,
  };
}

async function getScreenContext() {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      activeWindow: '',
      activeWindowIsSelf: false,
      otherWindows: [],
      unsupported: true,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
      { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 64 },
    );

    return parsePayload(stdout);
  } catch (error) {
    return {
      ok: false,
      activeWindow: '',
      activeWindowIsSelf: false,
      otherWindows: [],
      error: error.message,
    };
  }
}

module.exports = {
  getScreenContext,
};
