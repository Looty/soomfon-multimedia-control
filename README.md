# soomfon-multimedia-control

A StreamDock plugin that sends **play/pause, previous and next to one chosen
app** from the knob (or a key) of a Soomfon Stream Controller — instead of the
default Multimedia action, which broadcasts a global media key that also hits
the browser and anything else listening.

It uses the Windows media sessions (System Media Transport Controls, the same
per-app sessions behind the Windows media overlay), so the command goes to the
selected app only, needs no window focus, and needs no extra Windows config.

- **Knob**: rotate clockwise = next, counter-clockwise = previous, press = play/pause.
- **Key**: the operation chosen in the Property Inspector (play/pause, previous, next).
- **App**: *Foreground (Active)*, or *By Name* picked from a live dropdown of apps that
  currently own a media session (e.g. `Spotify.exe`, `com.github.th-ch.youtube-music`).
  If no matching session exists the button shows the alert flash.

- **Media popup** (on by default, checkbox in the Property Inspector): media-session calls
  bypass the Windows shell, so no flyout appears. After each command the plugin sends a
  volume-down/volume-up key pair, which nets to zero but makes Windows show its flyout.
  Side effects: a brief volume blip and it unmutes if muted. (Windows volume keys always
  step 2%; down-then-up keeps 100% at 100%.)

## Install

1. Copy `com.soomfonmultimedia.sdPlugin` into `%APPDATA%\HotSpot\StreamDock\plugins\`.
2. `cd com.soomfonmultimedia.sdPlugin\plugin && npm install`
3. Restart Stream Controller, then drag **App Multimedia** onto a knob/key.

## How it works

Same architecture as `soomfon-app-volume`: `plugin/index.js` handles events;
`plugin/mediaServer.js` keeps one persistent PowerShell (`media-server.ps1`) warm,
which calls the WinRT `GlobalSystemMediaTransportControlsSessionManager`
(`TryTogglePlayPauseAsync` / `TrySkipPreviousAsync` / `TrySkipNextAsync`) over a
JSON-lines protocol. Rapid knob ticks are rate-limited to one skip per 250 ms.

## Notes

- Only apps that expose a media session can be targeted (most players and browsers do;
  a browser appears as one entry covering all its tabs, so pick a dedicated player
  app to leave the browser alone).
- Foreground mode matches the focused window's process name against session ids
  loosely; apps whose session id differs from their exe name are best picked *By Name*.
- Logs: `com.soomfonmultimedia.sdPlugin\plugin\log.txt`.

## License

MIT — see [LICENSE](LICENSE).
