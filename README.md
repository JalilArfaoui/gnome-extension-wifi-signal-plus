# WiFi Signal Plus

GNOME Shell extension that displays the WiFi generation (4/5/6/7) in the top bar, with detailed connection info in a popup menu.

## Features

- **WiFi generation in the top bar**, color-coded:
  - WiFi 4 (802.11n): gray
  - WiFi 5 (802.11ac): blue
  - WiFi 6/6E (802.11ax): green
  - WiFi 7 (802.11be): purple
- **Detailed popup menu**:
  - Speed (link bitrate) with a logarithmic gauge
  - Channel width (20/40/80/160/320 MHz)
  - Modulation (MCS index, spatial streams)
  - Signal strength (dBm) with quality rating and history graph
  - Security (WPA/WPA2/WPA3) and BSSID
  - Nearby access points with generation and frequency band per AP

## Requirements

- GNOME Shell 45–50
- NetworkManager
- `iw` (optional — without it the extension falls back to NetworkManager data only, and generation details are unavailable)

## How it works

Data comes from two sources:

- **NetworkManager (libnm)**: SSID, BSSID, frequency, signal strength, bitrate, security, connection state
- **`iw dev <interface> link` / `scan dump`** (spawned asynchronously): WiFi generation detection via the modulation scheme — HT → WiFi 4, VHT → WiFi 5, HE → WiFi 6, EHT → WiFi 7 — plus channel width, MCS index and spatial streams

## Installation

### From extensions.gnome.org

Install from [extensions.gnome.org](https://extensions.gnome.org/) (search for "WiFi Signal Plus").

### From source

```bash
npm install
npm run install-extension
```

Then reload GNOME Shell (log out/in on Wayland) and enable the extension:

```bash
gnome-extensions enable wifi-signal-plus@jalil.arfaoui.net
```

## Development

The project is written in TypeScript, compiled to JavaScript with `tsc`. Development dependencies are managed with Nix + direnv (`flake.nix`, `.envrc`).

```bash
npm run build         # Compile TS + format dist + copy assets
npm test              # Run vitest tests
npm run lint          # ESLint on sources
npm run nested:safe   # Test in a nested GNOME Shell (isolated XDG_DATA_HOME)
npm run pack          # Build the zip for extensions.gnome.org submission
```

## License

[GPL-2.0](LICENSE)
