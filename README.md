# MargoDeck

MargoDeck is a wrapper around the [Margonem](https://www.margonem.pl) web game.
It opens the official website in its own window and translates gamepad input into keyboard and mouse events, so the game can be played with a controller or on the Steam Deck.
It does not change the game itself.

Coded with AI assistance.

What the wrapper adds:
- fullscreen window sized for the Steam Deck (1280×800) and a saved login session,
- built-in gamepad mapping (Gamepad API) with an in-app settings menu,
- trusted input events (`webContents.sendInputEvent`), so the game treats the pad like a real keyboard and mouse.

## Default controls

| Input | Action (Margonem default key) |
|---|---|
| Left stick | Move (W A S D) |
| Right stick | Mouse cursor |
| A / RT | Left click |
| LT | Right click |
| B | Escape / close battle window / close popup window (`Esc` / `Z`) |
| X | Quick fight / turn-based fight (`F` / `Q`) |
| Y | Talk to nearest NPC (`R`) |
| L1 | Battle sets (`Tab`) on a short press; hold as a modifier for the L1 + combinations below |
| R1 | Hold + D-pad or right stick: move the cursor one tile from the character in that direction (stick: any angle, D-pad: two directions = diagonal) |
| L3 | Mini map (`E`) |
| R3 | Center cursor on character |
| D-pad ↑ ↓ ← → | Inventory (`I`, bind it in game first) · Skills (`U`) · Battle log (`H`) · Chat (`C`) |
| View | World map (`M`) |
| Menu | Quests (`T`) |
| **View + Menu** | MargoDeck settings menu (fixed) |
| **Hold View** | Controls cheat sheet |
| L1 + A | Jump the cursor to the next field, button or clickable element |
| L1 + B | Jump the cursor to the previous field, button or clickable element |
| L1 + X | Attack nearest player (`X`) |
| L1 + Y | Invite to group (`V`) |
| L1 + L2 | Group (`G`) |
| L1 + D-pad ↑ / ↓ | Zoom + / − |
| L1 + D-pad ← | Resize battle log (`B`) |
| L1 + D-pad → | Reset zoom |

Hold **View** + **Menu** to open the settings menu. Its **App** section reloads the page, toggles fullscreen, sets the window size (the size is saved; picking one leaves fullscreen) and quits the app. In Steam Deck Gaming Mode the app always fills the screen, so the window size only matters in Desktop Mode or on a PC.

In the same menu you can remap the buttons. Pick a button with the D-pad, press A, choose an action or a keyboard key. Changes are saved immediately. You can also tap the entries on the touchscreen.
A button can press up to three keys at once: pick the button, then **+ Add another key…** (or **− Remove last key**). The D-pad and the left stick stay single-key.
Check the current game shortcuts in the Margonem settings and assign them here.

You can also edit `~/.config/MargoDeck/mapping.json` on the Deck (`%APPDATA%\MargoDeck\mapping.json` on Windows).
The file is created on first launch. It also sets `zoom`, the cursor speed, the stick deadzone and `nudgeTiles` (how far R1 + D-pad / right stick moves the cursor).
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

This produces `dist/MargoDeck-1.0.1.AppImage` (plus a `.tar.gz`).
The AppImage cannot be built on Windows itself (electron-builder has no Windows `mksquashfs`). Run the same command in WSL, or on the Deck itself in Konsole (with Node installed).

## Build for Windows

```
npm run dist:win
```

This produces two files in `dist/`:
- `MargoDeck-1.0.1-setup.exe`, an installer with Start menu and desktop shortcuts and an uninstaller,
- `MargoDeck-1.0.1-portable.exe`, a single file that runs without installation (it unpacks itself on every start, so it opens a few seconds slower).

## Install on the Steam Deck

1. Copy the `.AppImage` and `steam/install-on-deck.sh` into one folder on the Deck.
2. In Desktop Mode, open Konsole and run `bash install-on-deck.sh`.
3. In Steam, open MargoDeck **Properties → Controller** and pick the **"Gamepad"** template.
   Without it, Steam may send its own keyboard/mouse emulation instead of the gamepad.
4. Go back to Gaming Mode and launch MargoDeck. Hold View to see the controls.

## Windows

MargoDeck also runs on Windows 10 and 11 with any controller that works in the browser (Xbox, PlayStation, generic XInput pads).
Download `MargoDeck-<version>-setup.exe` to install it, or `MargoDeck-<version>-portable.exe` to run it without installing.

The executables are not code-signed, so Windows SmartScreen may show "Windows protected your PC" on the first start.
Click **More info** → **Run anyway**.

Settings and the button mapping are stored in `%APPDATA%\MargoDeck`.

## Login popups (Google, Facebook, Apple)

Login popups from Google, Facebook and Apple open as child windows inside the app.
They share the session cookies, so a login done there carries over to the game.
Gamepad input goes to whichever window has focus. You can also tap the Deck's touchscreen.
The popup usually closes itself after logging in. Otherwise close it with **B** (or Ctrl+Esc).
Links to any other site open in the system browser.

The app removes `Electron` from its user agent, because Google blocks sign-in from browsers that look embedded.
If Google still shows "This browser or app may not be secure", log in with a Margonem login and password instead.

## Disclaimer

MargoDeck is an unofficial fan project. It is not affiliated with or endorsed by the makers of Margonem.
It only displays the official website and translates gamepad input into keyboard and mouse events. It does not automate gameplay.
