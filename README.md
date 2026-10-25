# 🎵 SpectroScope

Browser-based audio spectrum analyzer + Apple-Music-style player with a **Liquid Glass** interface. Audio never leaves your device.

## Tabs (draggable glass nav)
- **Import** – drop/choose many files; a library list with cover art, title/artist, format badge, duration, live equalizer on the playing row. Tap a row to play it.
- **Media Info** – chunked FFT spectrogram with axes, quality badges (CD / HI-RES / HIGH), and General / Audio / Image panels.
- **Player** – large cover (breathes when playing), blurred-art ambient background, seek bar, prev/play/next, volume, lock-screen controls (Media Session).

## Liquid Glass
`glass.js` builds a convex-squircle bezel height profile, applies **Snell's law** (air n=1 → glass n=1.5) to get per-pixel deflection, encodes it as a displacement map, and feeds an SVG `feDisplacementMap` (3 staggered channel passes = chromatic aberration) through `backdrop-filter: url(#filter)`.
- **Chromium (Chrome, Edge, Android):** true edge refraction.
- **Safari / Firefox:** frosted blur + saturation + specular rim (browsers don't support SVG filters in `backdrop-filter`). The magnified icon lens inside the bubble works everywhere.
- **Bubble physics:** grab the bubble and drag. It grows when pressed, stretches/squashes with velocity, and settles with an underdamped spring ("jelly") on the nearest tab. Tap a tab to fly there.

## Files
`index.html` shell · `styles.css` · `app.js` (library/player/info/dock) · `glass.js` (refraction engine) · `parsers.js` (FFT + ID3/FLAC/MP4/Ogg readers, unchanged) · `sw.js` (v4 cache) · `manifest.json` · `icon.svg`

## Run
Serve over HTTPS or a local server (`python3 -m http.server`), then install as a PWA. `jsmediatags` loads from a CDN; the built-in cover-art parsers still work without it.

## Notes
- Only the current track is decoded for the spectrogram; the last 3 spectrograms are cached.
- Lossless/Hi-Res badges are heuristics from container metadata and file size.
