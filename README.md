# Aether

A local Roblox script workspace for Windows. Aether pairs a Lua editor, saved-script library and themeable interface with a loopback WebSocket bridge that sends code to an executor such as Potassium.

## Requirements

- Windows 10/11
- Node.js 20 or newer (developed on Node 24)
- An executor that exposes `WebSocket` and `loadstring` / `load` (Potassium and most modern executors)
- Internet access for community hub results

## Run

```powershell
npm install
npm start
```

The app has no build step. Electron loads `renderer/index.html` directly, and the bridge starts with the app on `127.0.0.1:7963` by default.

## Connect an executor

1. Open Aether and click the bridge pill in the titlebar (or open **Settings → Connection**).
2. Click **Copy loader script**.
3. Paste it into your executor's editor and execute it once while the game is running.
4. The client appears in the bridge popover. Choose **All clients** or a subset.
5. Click **Test bridge** to send a small Lua chunk. The client's print and a `Finished in … ms` result appear in the console, confirming end-to-end execution.

Attached clients are also listed under **Settings → Connection**, where you can disconnect one client or all of them.

The loader reconnects every 3 seconds while Aether is running. An intentional **Disconnect** from Aether retires the loader, so run it again when you want that client back.

The loader identifies its protocol version. A client still running an old copy shows **Stale loader**; copy the loader from **Settings → Connection** and run it again.

The port is configurable under **Settings → Connection**. The loader embeds the current port, so copy it again after changing ports.

## Script hub

- Bundled snippets are available without a network connection.
- Community results come from **ScriptBlox** and **RobloxScripts**.
- Requests run in the Electron main process; the renderer keeps a strict CSP with `connect-src 'none'`.
- Responses are normalised and cached in memory for four minutes. If a provider is temporarily offline, the last good response is shown with a retry action.
- **Load more** appends the next page from the active providers.
- External script links are restricted to `scriptblox.com` and `robloxscripts.com` over HTTPS.

## Project layout

| File | Purpose |
| --- | --- |
| `main.js` | Electron window, bridge lifecycle, config/session storage, provider IPC |
| `preload.js` | Context-bridged API exposed to the renderer |
| `bridge.js` | Dependency-free RFC 6455 WebSocket server on loopback |
| `bridge-script.lua` | Loader pasted into the executor; handles reconnect, logs, results |
| `hub-providers.js` | ScriptBlox / RobloxScripts fetching, normalisation and cache |
| `renderer/index.html` | Application shell and views |
| `renderer/app.js` | Application state, hub, library, clients, console |
| `renderer/editor.js` | Lua tokenizer, editor surface, shortcuts |
| `renderer/hub.js` | Bundled scripts (`window.HUB_SCRIPTS`) |
| `renderer/styles.css` | Themes, layout and component styles |

## Storage

Settings, the current session and the saved-script library live in Electron's user-data folder:

```
%APPDATA%\Aether
```

`config.json` holds appearance, editor and bridge preferences. `session.json` restores open tabs. `scripts.json` is the saved library.

## Troubleshooting

- **Client connects but never executes** — the executor may not expose a compatible WebSocket message event, or it may deliver frame objects instead of strings. Re-run the current loader; it supports signal-style events, callable events, callback properties and both string and `Data` frame payloads. If the message channel is broken, the client stays on **Handshaking**, turns to **Not answering** after ten seconds, and the console points back to the loader.
- **No clients appear** — confirm the loader is running in the attached game and that the app is listening on the same port. Check the console for bridge errors.
- **Community hub is empty** — try **Retry**. If both providers fail, check the network connection; bundled scripts remain available under **Built-in**.
- **External link does not open** — only ScriptBlox and RobloxScripts links are allowed by design.