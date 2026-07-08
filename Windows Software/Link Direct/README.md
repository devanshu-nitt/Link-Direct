# LINK — Fast WiFi File Transfer

Send files between your Android phone and Windows PC over your local WiFi network. No cables, no cloud, no account. Runs entirely on your own network — nothing leaves it.

## How it works

One computer (usually your Windows PC) runs a small local server. Both devices then open the **same page in a normal browser** — Chrome, Edge, Firefox, whatever — and can drag files to send or tap to download. It's a two-way shared folder, live-synced between both screens.

## Requirements

- **Windows PC:** [Node.js](https://nodejs.org) installed (one-time, ~2 minutes). Choose the LTS version.
- **Android phone:** nothing to install — just a browser.
- Both devices connected to **the same WiFi network**.

## Setup (Windows — do this once)

1. Unzip this folder anywhere on your PC.
2. Double-click **`start-windows.bat`**.
   - First time only: it will install one small dependency automatically.
3. A window opens showing something like:
   ```
   Network: http://192.168.1.42:8080
   ```
   Keep this window open — it's your server. Closing it stops the transfer service.

## Connect your Android phone

1. Make sure your phone is on the same WiFi as the PC.
2. Open any browser on the phone and either:
   - Type in the `Network:` address shown in the PC's terminal window, **or**
   - Open the app on the PC's browser (`http://localhost:8080`) and scan the **QR code** shown on screen with your phone's camera.
3. That's it — both devices now show the same live file list.

## Using it

- **To send a file:** drag it onto the drop zone (PC) or tap the drop zone to choose a file (phone). It uploads immediately and appears on both screens as soon as it's done.
- **To receive a file:** tap the download arrow next to any file in the list.
- **To remove a file:** tap the ✕ next to it. This removes it from the shared list on both devices.
- Progress bars show live speed and percentage while a transfer is in flight, on both ends.

## Why it's fast

Files are streamed directly to disk in chunks rather than loaded into memory, so transfer speed is limited only by your WiFi link — typically tens to a few hundred MB/s on a modern router, far faster than emailing files to yourself or routing through a cloud drive.

## Where files are stored

Uploaded files live in the `shared` folder inside this app's directory on whichever computer is running the server. They stay there until you delete them from the app (or delete them from that folder directly).

## Stopping the server

Close the terminal window, or press `Ctrl+C` inside it.

## Troubleshooting

- **Phone can't reach the address:** confirm both devices are on the same WiFi network (not one on WiFi and one on mobile data), and that your PC's firewall isn't blocking Node.js — Windows will usually prompt to allow it the first time; choose "Allow access."
- **Port already in use:** close other apps using port 8080, or edit `server.js` and change `PORT` at the top, then restart.
