# MargoDeck

MargoDeck is a wrapper around the [Margonem](https://www.margonem.pl) web game.
It opens the official website in its own window and translates gamepad input into keyboard and mouse events, so the game can be played with a controller or on the Steam Deck.
It does not change the game itself.

What the wrapper adds:
- fullscreen window sized for the Steam Deck (1280×800) and a saved login session,
- built-in gamepad mapping (Gamepad API) with an in-app settings menu,
- trusted input events (`webContents.sendInputEvent`), so the game treats the pad like a real keyboard and mouse.

## Default controls

| Input | Action (Margonem default key) |
|---|---|
| Left stick | Move (W A S D) |
| Right stick | Mouse cursor |
| A | Left click |
| RT | Turn-based fight (`Q`) |
| LT | Right click |
| B | Escape |
| X | Quick fight (`F`) |
| Y | Talk to nearest NPC (`R`) |
| L1 | Battle sets (`Tab`) |
| R1 | Close battle window (`Z`) |
| L3 | Mini map (`E`) |
| R3 | Center cursor on character |
| D-pad ↑ ↓ ← → | Inventory (`I`, bind it in game first) · Battle log (`H`) · Skills (`U`) · Chat (`C`) |
| View | World map (`M`) |
| Menu | Quests (`T`) |
| **View + Menu** | MargoDeck settings menu (fixed) |
| **Hold View** | Controls cheat sheet |
| View + B | Close popup window (e.g. login) |
| View + X | Attack nearest player (`X`) |
| View + L2 / R2 | Group (`G`) / Invite to group (`V`) |
| View + R3 | Resize battle log (`B`) |
| View + L1 / R1 | Zoom − / + |
| View + L3 | Reset zoom |

Hold **View** + **Menu** to open the settings menu. Its **App** section reloads the page, toggles fullscreen and sets the window size (the size is saved; picking one leaves fullscreen). In Steam Deck Gaming Mode the app always fills the screen, so the window size only matters in Desktop Mode or on a PC.

In the same menu you can remap the buttons. Pick a button with the D-pad, press A, choose an action or a keyboard key. Changes are saved immediately. You can also tap the entries on the touchscreen.
Check the current game shortcuts in the Margonem settings and assign them here.

You can also edit `~/.config/MargoDeck/mapping.json` on the Deck (`%APPDATA%\MargoDeck\mapping.json` on Windows).
The file is created on first launch. It also sets `zoom`, the cursor speed and the stick deadzone.
**F11** toggles fullscreen and **F5** reloads the page.

## Development

Requires Node.js 20 or newer.

```
npm install
npm start -- --windowed
```

## Build for the Deck

```
npm run dist:linux
```

This produces `dist/MargoDeck-0.1.0.AppImage` (plus a `.tar.gz`).
If electron-builder will not build the AppImage on Windows, run the same command in WSL, or on the Deck itself in Konsole (with Node installed).

## Install on the Steam Deck

1. Copy the `.AppImage` and `steam/install-on-deck.sh` into one folder on the Deck.
2. In Desktop Mode, open Konsole and run `bash install-on-deck.sh`.
3. In Steam, open MargoDeck **Properties → Controller** and pick the **"Gamepad"** template.
   Without it, Steam may send its own keyboard/mouse emulation instead of the gamepad.
4. Go back to Gaming Mode and launch MargoDeck. Hold View to see the controls.

## Login popups (Google, Facebook, Apple)

Login popups from Google, Facebook and Apple open as child windows inside the app.
They share the session cookies, so a login done there carries over to the game.
Gamepad input goes to whichever window has focus. You can also tap the Deck's touchscreen.
The popup usually closes itself after logging in. Otherwise close it with **View + B** (or Ctrl+Esc).
Links to any other site open in the system browser.

The app removes `Electron` from its user agent, because Google blocks sign-in from browsers that look embedded.
If Google still shows "This browser or app may not be secure", log in with a Margonem login and password instead.

## Disclaimer

MargoDeck is an unofficial fan project. It is not affiliated with or endorsed by the makers of Margonem.
It only displays the official website and translates gamepad input into keyboard and mouse events. It does not automate gameplay.
