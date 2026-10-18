// Minimal Stream Dock plugin<->app websocket bridge.
// The host launches this as: node index.js -port P -pluginUUID U -registerEvent E -info I
// i.e. flag/value pairs, so the values sit at argv[3], argv[5], argv[7], argv[9].
// (Verified against a real installed first-party plugin's boilerplate,
// com.mirabox.streamdock.spotify.sdPlugin/plugin/utils/plugin.js, not just a public template.)
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'log.txt');
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}
process.on('uncaughtException', (err) => log('uncaughtException: ' + (err?.stack || err)));
process.on('unhandledRejection', (err) => log('unhandledRejection: ' + (err?.stack || err)));

class Plugins {
  constructor() {
    if (Plugins.instance) return Plugins.instance;
    this.ws = new WebSocket('ws://127.0.0.1:' + process.argv[3]);
    this.ws.on('open', () => this.ws.send(JSON.stringify({ uuid: process.argv[5], event: process.argv[7] })));
    this.ws.on('close', () => process.exit(0));
    this.ws.on('error', (err) => { log('ws error: ' + err); process.exit(1); });
    this.ws.on('message', (raw) => {
      const data = JSON.parse(raw.toString());
      log('recv event=' + data.event + ' action=' + data.action + ' context=' + data.context + ' payload=' + JSON.stringify(data.payload));
      const action = data.action?.split('.').pop();
      try {
        this[action]?.[data.event]?.(data);
        this[data.event]?.(data);
      } catch (err) {
        log('handler error for event=' + data.event + ': ' + (err?.stack || err));
      }
    });
    Plugins.instance = this;
  }
  setTitle(context, title) {
    this.ws.send(JSON.stringify({ event: 'setTitle', context, payload: { target: 0, title } }));
  }
  setImage(context, dataUrl) {
    this.ws.send(JSON.stringify({ event: 'setImage', context, payload: { target: 0, image: dataUrl } }));
  }
  setState(context, state) {
    this.ws.send(JSON.stringify({ event: 'setState', context, payload: { state } }));
  }
  setSettings(context, payload) {
    this.ws.send(JSON.stringify({ event: 'setSettings', context, payload }));
  }
  showAlert(context) {
    this.ws.send(JSON.stringify({ event: 'showAlert', context }));
  }
  showOk(context) {
    this.ws.send(JSON.stringify({ event: 'showOk', context }));
  }
  // Reply to a PI's `sendToPlugin` call. Verified against the real installed
  // com.hotspot.streamdock.system.monitor.sdPlugin ("Custom System Monitor"),
  // whose PropertyInspector/js/action.js is a copy of Elgato's open-source
  // common.js: SDApi.registerPropertyInspector.sendToPlugin sends
  // {event:'sendToPlugin', context: piUUID, action, payload}, and the PI
  // listens for the reply as {event:'sendToPropertyInspector', context,
  // action, payload}. Since we always answer within the same sendToPlugin
  // handler that received the request, we already have the context/action
  // that triggered it -- no need for the spotify plugin's separate
  // currentContext/currentAction bookkeeping.
  sendToPropertyInspector(context, action, payload) {
    this.ws.send(JSON.stringify({ event: 'sendToPropertyInspector', context, action, payload }));
  }
}

// Per-context settings storage. Every action instance (a specific key or
// knob slot the user dropped the action onto) gets its own `context` id from
// the host; `this.data[context]` must stay separate per instance so that,
// e.g., a "YouTube Music" knob slot and a "Foreground (Active)" knob slot
// never share state. (The sibling soomfon-claude-usage project's slideshow
// used a single shared `contexts`/`slideIndex` because it only ever had one
// instance — do not copy that shortcut here, this plugin is meant to run
// multiple independently-configured instances at once.)
class Actions {
  constructor(handlers) {
    this.data = {};
    this.default = handlers.default || {};
    Object.assign(this, handlers);
  }
  willAppear(data) {
    const { context, payload } = data;
    this.data[context] = Object.assign({}, this.default, payload?.settings);
    this._willAppear?.(data);
  }
  willDisappear(data) {
    this._willDisappear?.(data);
    delete this.data[data.context];
  }
  didReceiveSettings(data) {
    this.data[data.context] = Object.assign({}, this.default, data.payload?.settings);
    this._didReceiveSettings?.(data);
  }
}

module.exports = { Plugins, Actions, log };
