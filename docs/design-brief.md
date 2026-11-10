# Spotish — design brief for Claude Design

Paste everything below the line into Claude Design.

---

Design the complete UI for **Spotish**, a native desktop + mobile music client for Spotify's free tier. It is unofficial and must have its own identity. I want a design that makes people stop and look. Treat it as a flagship showcase for a native UI framework.

## What it is
- Plays Spotify (free tier, with ads kept intact) through a native app shell instead of the web player.
- Built with NSH (Native Shell): native views on every platform, GPU shaders (WGSL), spring and keyframe animation, adaptive layouts. One codebase runs on macOS, Windows, Linux, iOS, Android, Web and a terminal (TUI).
- The design should show off what native can do: real depth, light, live shader backgrounds, and fluid motion, all at 120 fps.

## Direction
- Keep Spotify's general information architecture: left sidebar (Home, Search, Your Library), main content, bottom player bar, full-screen Now Playing. Users should feel at home.
- Do **not** clone Spotify's look. No Spotify green as the brand color, no Spotify logo or icon style.
- Avoid these, which I have already rejected: plain two-stop gradients, flat dark dashboard with a single blue accent, generic glassmorphism, lime/chartreuse, coral/ember orange.
- Craft I like (borrow the technique, not the look): nsh.dev's homepage — controls that feel like real objects with highlight, inner shadow and soft glow; a subtle dot grid; restrained, precise typography.
- Album art is the most colorful thing on screen. The chrome should frame it, and Now Playing can take its colors from the current cover.
- Explore **3 distinct visual directions** first (each: palette, type pairing, control style, one hero screen), then develop the one I pick into all screens.

## Screens
1. Desktop main: Home (greeting, "Jump back in", "Made for you" rows of cards).
2. Search: search field + browse categories + results (tracks, artists, albums, playlists).
3. Collection detail: playlist / album / artist / Liked Songs header + track list.
4. Now Playing: full screen, large cover, live animated background, transport, progress.
5. Player bar: cover, title/artist, like, shuffle/previous/play/next/repeat, progress with times, volume.
6. Sign-in prompt, About sheet (explains NSH, unofficial disclaimer), toast notices.
7. Phone: Home, Now Playing, mini player, bottom tab bar, library drawer.
8. Narrow desktop: sidebar collapses to an icon rail.
9. Light and dark themes for everything.

## Components to specify
Logo and app icon (music-related, ownable, not Spotify-like), icon set (24px, one consistent style), play button, ghost icon buttons (circular hover background), pill buttons, sidebar nav item, library row, card with hover play button, track row (number, title, artist, duration in mono figures), progress and volume sliders (thicker than a hairline, not a flat solid fill), toast, dialog/sheet, empty and loading states (skeletons).

## Motion and effects (annotate each)
- Page transitions (push/pop between Home → Playlist), hover lift, press settle, card play button reveal, like burst, play/pause morph, slider thumb reveal, rolling time digits.
- Now Playing: cover-tinted animated shader background; cover gently breathing while playing.
- Respect reduced motion.

## Required product details
- A visible but tasteful "Get Premium" entry (sidebar footer and top bar) and an "Advertisement" state in the player bar during ads, with a "Get Premium" link.
- "Built with NSH" credit in the About sheet and sidebar footer.
- "Unofficial — not affiliated with Spotify" in About.

## Constraints for implementation
- Every color must be a named theme token (background, foreground, card, popover, primary, primary-foreground, secondary, muted, muted-foreground, accent, border, ring, plus app tokens). Give token tables for light and dark.
- On Omarchy Linux the app follows the system theme, so the design must still work when its tokens are replaced by another palette. Keep the identity in shape, depth, type and motion, not only in hue.
- Radii, spacing and type scale as tokens. Numbers (times, counts) in a monospace face.
- Icons are SVG. Gradients, shadows, blur and shaders are all available; keep text contrast AA.
- Terminal version: describe how the layout degrades to text (no images).
