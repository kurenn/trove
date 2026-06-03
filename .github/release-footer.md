## Downloads

| Platform | Download |
|---|---|
| 🍎 **macOS — Apple Silicon** (M1/M2/M3/M4) | `Trove_*_aarch64.dmg` |
| 🍎 **macOS — Intel** | `Trove_*_x64.dmg` |
| 🪟 **Windows** | `Trove_*_x64-setup.exe` (or `Trove_*_x64_en-US.msi`) |
| 🐧 **Linux** | `Trove_*_amd64.AppImage`, `.deb`, or `.x86_64.rpm` |

> The `.app.tar.gz` and `.sig` files are for Trove's in-app auto-updater — you don't need to download them.

### 🍎 macOS — "Trove is damaged and can't be opened"

That message is **not** a corrupt download — Trove isn't notarized by Apple yet, so macOS blocks it. To open it:

1. Drag **Trove.app** from the `.dmg` into your **Applications** folder.
2. Open **Terminal** and run:
   ```
   xattr -dr com.apple.quarantine /Applications/Trove.app
   ```
3. Open Trove normally. You only need to do this once.

### 🪟 Windows
SmartScreen may warn "Windows protected your PC" → **More info → Run anyway**.
