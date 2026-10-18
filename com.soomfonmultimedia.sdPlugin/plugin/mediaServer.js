// Manages ONE persistent, warm powershell.exe running media-server.ps1,
// shared across every action instance/context. Talks to it over newline-
// delimited JSON on stdin/stdout instead of spawning a fresh process (and
// re-loading the WinRT media-session types) on every knob event.
//
// Con worth knowing: this process sits resident in memory for the plugin's
// whole lifetime (a bare powershell.exe host is roughly 30-60MB). If it dies,
// media control breaks until respawned -- handled below with exit-triggered
// respawn and a crash-loop guard so a persistently broken environment fails
// loudly (in log.txt) instead of spinning forever.
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { log } = require('./utils/plugin');

const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const SCRIPT = path.join(__dirname, 'media-server.ps1');
const REQUEST_TIMEOUT_MS = 5000;
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 10_000;

let child = null;
let ready = false;
let readyWaiters = [];
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }
const crashTimestamps = [];
let disabled = false; // set true after repeated crash-looping; stop trying

function rejectAllPending(reason) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(reason));
  }
  pending.clear();
}

function start() {
  if (disabled || child) return;
  log('mediaServer: spawning ' + SCRIPT);
  child = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true });
  ready = false;

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log('mediaServer: unparsable line from PS: ' + line);
      return;
    }
    if (msg.ready) {
      ready = true;
      log('mediaServer: ready');
      const waiters = readyWaiters;
      readyWaiters = [];
      waiters.forEach((w) => w());
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return; // stale/unmatched response, ignore
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    entry.resolve(msg);
  });

  child.stderr.on('data', (d) => log('mediaServer stderr: ' + d.toString().trim()));

  child.on('exit', (code, signal) => {
    log(`mediaServer: process exited (code=${code}, signal=${signal})`);
    child = null;
    ready = false;
    rejectAllPending('media-server process exited');

    const now = Date.now();
    crashTimestamps.push(now);
    while (crashTimestamps.length && now - crashTimestamps[0] > CRASH_WINDOW_MS) crashTimestamps.shift();
    if (crashTimestamps.length > MAX_CRASHES) {
      disabled = true;
      log('mediaServer: crash-looping (' + crashTimestamps.length + ' exits in ' + CRASH_WINDOW_MS + 'ms) -- giving up, media control disabled until plugin restart');
      return;
    }
    start(); // respawn
  });
}

function waitUntilReady() {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => readyWaiters.push(resolve));
}

// Fire-and-forget-safe request: resolves with the PS response object, or
// rejects on timeout/crash. Callers should treat rejection the same as the
// old execFile error path (leave the display as-is, log it).
async function request(cmd) {
  if (disabled) throw new Error('media-server disabled after repeated crashes');
  start();
  await waitUntilReady();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('media-server request timed out: ' + JSON.stringify(cmd)));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, ...cmd }) + '\n');
  });
}

function shutdown() {
  try { child?.stdin?.end(); } catch { }
  try { child?.kill(); } catch { }
}
process.on('exit', shutdown);

module.exports = { start, request, shutdown };
