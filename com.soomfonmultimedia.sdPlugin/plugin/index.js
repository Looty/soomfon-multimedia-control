const { Plugins, Actions, log } = require('./utils/plugin');
const mediaServer = require('./mediaServer');

// Knob rotation fires one event per detent; a fast spin would skip a pile of
// tracks. Ticks landing within this window of the last handled one are dropped.
const ROTATE_COOLDOWN_MS = 250;
const lastRotate = new Map(); // context -> timestamp of last handled rotate

const KEY_OPS = new Set(['playpause', 'previous', 'next']);

function targetCmd(op, settings) {
  return {
    op,
    mode: settings.processMode === 'byname' ? 'byname' : 'foreground',
    processName: settings.processName || '',
    flyout: settings.showFlyout !== false,
  };
}

async function runOp(op, settings, context) {
  const started = Date.now();
  try {
    const result = await mediaServer.request(targetCmd(op, settings));
    log(`op ${op} context=${context} took ${Date.now() - started}ms result=${JSON.stringify(result)}`);
    // No matching media session (app closed / nothing playing yet): flash
    // the standard "alert" so the press doesn't just silently do nothing.
    if (!result.ok) plugin.showAlert(context);
  } catch (err) {
    log(`op ${op} context=${context} failed after ${Date.now() - started}ms: ${err.message}`);
    plugin.showAlert(context);
  }
}

const plugin = new Plugins();

// Load the WinRT media-session types in the background before the first press.
mediaServer.start();

plugin.mediacontrol = new Actions({
  default: { processMode: 'foreground', processName: '', keyOperation: 'playpause', showFlyout: true },

  // Rotate: clockwise = next track, counter-clockwise = previous.
  dialRotate({ context, payload }) {
    const now = Date.now();
    if (now - (lastRotate.get(context) || 0) < ROTATE_COOLDOWN_MS) return;
    lastRotate.set(context, now);
    const settings = this.data[context] || this.default;
    runOp(payload?.ticks < 0 ? 'previous' : 'next', settings, context);
  },

  // Knob click: play/pause.
  dialDown({ context }) {
    runOp('playpause', this.data[context] || this.default, context);
  },

  // Regular key: whichever operation is chosen in the Property Inspector.
  keyDown({ context }) {
    const settings = this.data[context] || this.default;
    const op = KEY_OPS.has(settings.keyOperation) ? settings.keyOperation : 'playpause';
    runOp(op, settings, context);
  },

  // The PI's "By Name" dropdown asks for apps that currently have a media session.
  async sendToPlugin(data) {
    const { context, action, payload } = data;
    if (payload?.event !== 'requestAppList') return;
    try {
      const result = await mediaServer.request({ op: 'list' });
      plugin.sendToPropertyInspector(context, action, { event: 'appList', apps: result.ok ? result.apps : [] });
    } catch (err) {
      log('requestAppList failed: ' + err.message);
      plugin.sendToPropertyInspector(context, action, { event: 'appList', apps: [] });
    }
  },
});
