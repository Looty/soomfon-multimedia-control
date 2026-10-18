// Standard Elgato-style PI entry point (same signature as soomfon-app-volume).
//
// The "By Name" dropdown is populated live from the plugin backend, which
// lists the apps that currently own a Windows media session. It's only a
// picker: what gets stored and matched at runtime is the session id string.

const DEFAULTS = { processMode: 'foreground', processName: '', keyOperation: 'playpause', showFlyout: true };
const OTHER_VALUE = '__other__';

const $processMode = document.getElementById('processMode');
const $processNameRow = document.getElementById('processNameRow');
const $processNameSelect = document.getElementById('processNameSelect');
const $processName = document.getElementById('processName');
const $processNameHint = document.getElementById('processNameHint');
const $keyOperation = document.getElementById('keyOperation');
const $showFlyout = document.getElementById('showFlyout');

let ws = null;
let context = null;
let actionUUID = null;
let settings = { ...DEFAULTS };
let appList = null; // null = not fetched yet; array once the backend replies

function applySettings(newSettings) {
  settings = { ...DEFAULTS, ...newSettings };
  $processMode.value = settings.processMode;
  $processName.value = settings.processName;
  $keyOperation.value = settings.keyOperation;
  $showFlyout.checked = settings.showFlyout !== false;
  syncVisibility();
  populateAppDropdown();
}

function syncVisibility() {
  $processNameRow.style.display = settings.processMode === 'byname' ? 'flex' : 'none';
}

function showManualEntry(show) {
  $processName.style.display = show ? 'block' : 'none';
  $processNameHint.style.display = show ? 'block' : 'none';
}

// Keeps a configured value selectable ("(not running)") even when it's absent
// from the freshly fetched list; the setting stays valid and starts matching
// again once that app opens a media session.
function populateAppDropdown() {
  if (appList === null) return;
  $processNameSelect.replaceChildren();

  const current = settings.processName;
  if (current && !appList.includes(current)) {
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = `${current} (not running)`;
    $processNameSelect.appendChild(opt);
  }

  for (const name of appList) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    $processNameSelect.appendChild(opt);
  }

  const otherOpt = document.createElement('option');
  otherOpt.value = OTHER_VALUE;
  otherOpt.textContent = 'Other... (type manually)';
  $processNameSelect.appendChild(otherOpt);

  if (current) {
    $processNameSelect.value = current;
    showManualEntry(false);
  } else {
    $processNameSelect.value = OTHER_VALUE;
    showManualEntry(true);
  }
}

function save() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ event: 'setSettings', context, payload: settings }));
}

function requestAppList() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !actionUUID) return;
  ws.send(JSON.stringify({ event: 'sendToPlugin', context, action: actionUUID, payload: { event: 'requestAppList' } }));
}

$processMode.addEventListener('change', () => {
  settings.processMode = $processMode.value;
  syncVisibility();
  save();
});

$processNameSelect.addEventListener('change', () => {
  const v = $processNameSelect.value;
  if (v === OTHER_VALUE) {
    settings.processName = $processName.value || '';
    showManualEntry(true);
  } else {
    settings.processName = v;
    showManualEntry(false);
  }
  save();
});

$processName.addEventListener('input', () => {
  settings.processName = $processName.value;
  save();
});

$keyOperation.addEventListener('change', () => {
  settings.keyOperation = $keyOperation.value;
  save();
});

$showFlyout.addEventListener('change', () => {
  settings.showFlyout = $showFlyout.checked;
  save();
});

function connectElgatoStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
  context = inUUID;
  let actionInfo = {};
  try { actionInfo = JSON.parse(inActionInfo); } catch { }
  actionUUID = actionInfo?.action || null;
  if (actionInfo?.payload?.settings) applySettings(actionInfo.payload.settings);

  ws = new WebSocket('ws://127.0.0.1:' + inPort);
  ws.onopen = () => {
    ws.send(JSON.stringify({ event: inRegisterEvent, uuid: inUUID }));
    requestAppList();
  };
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.event === 'didReceiveSettings') {
      applySettings(data.payload?.settings || {});
    } else if (data.event === 'sendToPropertyInspector' && data.payload?.event === 'appList') {
      appList = data.payload.apps || [];
      populateAppDropdown();
    }
  };
}

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

syncVisibility();
