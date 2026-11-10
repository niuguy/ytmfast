# Spotish design

How Spotish looks and moves, as built. These rules sit on top of the
[NSH Design Guides](https://nsh.dev/docs/design-guides.md); where the two
differ, these win for Spotish. Change a rule here first, then in the code;
where this document and the code disagree, fix one of them.

Values below are points (pt) unless marked. File paths are relative to the
repository root.

## Principles

- **Its own look.** Spotify's information architecture (sidebar, pages,
  player bar, Now Playing), not Spotify's look. Spotish's identity lives in
  shape, depth, type and motion, so it survives any palette the system hands
  it.
- **Dark, quiet, flat.** The pages, the window and Now Playing share one
  near-black. No grey content panel, no decorative gradients, no colour wash
  at the top of a page. Album art is the most colourful thing on screen.
- **The light leads.** The only colour that moves is the music light, drawn
  from the cover. Controls stay quiet so they don't compete with it.
- **Compact.** Don't waste rows: one band for a collection's header, one line
  per library row.
- **Fast and light.** Spotish is NSH's showcase. Nothing redraws without a
  change to show; anything that can grow is virtualized.

## At a glance

On a dark system theme (here an Omarchy theme, so nearly pure black) the
desktop window reads like this:

- **One black field.** The pages and the sidebar's panels share the
  background; the panels stand out only by a faint 1px border and their 16pt
  corners. Covers carry all the colour.
- **Sidebar of three rounded panels**: Home on its own; the library, one line
  per entry with round covers (Liked Songs a round theme-red tile with a
  white heart), the selected entry on a lighter `secondary` slab; the account
  (avatar, name, a chevron) at the foot. The library fades out at its bottom
  edge.
- **A thin header row** with no title: the sidebar toggle, Back and Forward
  (dimmed when unavailable) at the left; Search, the Premium crown and ✕ at
  the right, all bare 18pt outline glyphs. With the sidebar folded, the
  user's round avatar comes first.
- **Big bold page titles** ("Good evening", an artist's name) flush with the
  12pt gutter, then sections with `text-xl` bold titles over rows of square
  cards: cover, a bold one-line name, a muted two-line "Kind · Owner". A
  hovered card gets a soft wash and its play disc in the cover's corner.
- **The player bar floats** as a 72pt pill over the bottom of the pages,
  a step lighter than the page with a faint rim and the music light (Dots by
  default) glowing low inside it. Round cover, title and artist, a dimmed
  heart; the transport centred over a thin position bar with monospace times;
  the volume and ✦ at the right.
- **An artist's page**: a round 96pt picture beside an ARTIST overline, the
  name in `text-3xl` extrabold and "monthly listeners" in muted text, the
  play button at the far right; a track table (TITLE overline, a clock glyph
  over the lengths, a hairline under the header, no Album column for an
  artist); then a Discography grid that fills the row.
- On Linux under a tiling window manager there is no title bar at all: the
  header row is the top of the window.

## Colour

### Tokens

Every colour is a token, never a literal in a component. The defaults are
`theme.json` (light and dark); `nsh.json` sets `"appearance": "system"`.

| Role | Tokens | Used for |
|---|---|---|
| Page | `sidebar` | The window, every page (`AppPage`), Now Playing |
| Panel | `card`, `border` | The sidebar's three panels (nav, library, account) |
| Raised | `secondary`, `muted` | Selection, the search field, pressed rows, skeletons |
| Row hover | `row-hover` | Hovered rows and cards |
| Popup | `popover`, `popover-foreground` | Menus, dialogs, toasts, tooltips |
| Player | `player` | The player bar's surface, the web's tab bar |
| Scrim | `shell` (at 80%) | Behind dialogs and sheets |
| Text | `foreground`, `muted-foreground` | Primary and secondary text |
| Accent | `primary`, `primary-foreground`, `ring` | Links, the current library row, a toast's action, focus |
| Liked | `liked`, `liked-foreground` | The liked heart, the like burst, Liked Songs' cover |
| Danger | `destructive` | Errors |

Rules:

- **Controls are `foreground`, never coloured.** The play button, the
  sliders, toggles that are on: all take `tint()` (`src/state/tint.ts`),
  which is the theme's foreground. A white control reads over any cover and
  any light; a coloured one clashes. `vivid()` exists should a cover-coloured
  control ever be wanted; none is.
- **The primary button is `foreground`** (`bg-foreground`, `text-background`,
  `ActionButton variant="primary"`), not the accent. `primary` is kept small:
  text links, the playing collection's name in the library, a toast's action
  pill, the focus ring.
- **Liked follows the system.** `liked` is the theme's red (`#f2555a` dark,
  `#e5484d` light in `theme.json`; on Omarchy the theme's own `red`). The like
  button is always the filled heart: `foreground` (dimmed until hovered) while
  not liked, `liked` once liked. Never an outline. Liked Songs' cover is a
  `liked` tile with a `liked-foreground` heart.
- **Popups are solid and dark** (`popover`, a step above the window), never
  pale grey.

### Following the system theme

On Omarchy the app takes the current theme's colours and appearance and
changes with it live (`src/platform/theme.ts`, read and watched in Rust by
`src/theme.rs`). Elsewhere `theme.json` applies. This is intentional: design
for any palette, not only the defaults.

The mapping (`src/platform/palette.ts`, tested against `src/platform/fixtures`)
trusts only the theme's `background`, `foreground`, `accent` and `red`, and
derives every other role by mixing, with contrast checks:

- `foreground` is pushed to 7:1 on the background.
- `primary` is the theme's accent (else blue) at 3:1; `primary-foreground`
  4.5:1 on it.
- Surfaces step from the background toward the foreground: `secondary` 7%,
  `muted` 11%, `border` 12%, `input` 15%, `row-hover` 6%, `popover` and
  `player` 4% (dark; lighter steps in light).
- `sidebar` and `shell` recede: the background mixed 50% toward black (dark).
- `muted-foreground` is foreground 40% toward the background, held at 4.5:1.
- `liked` is the theme's red at 3:1; its heart is white wherever white reads
  at 3:1.

Radii and `font-mono` are kept from `theme.json` when the system theme
replaces the colours.

## Typography

The system's sans; JetBrains Mono for figures where installed, else
`ui-monospace`, then `monospace` (`font-mono` is a fallback list, so no system
warns about a missing font).

| Use | Class |
|---|---|
| Home's greeting | `text-4xl font-extrabold` |
| A collection's name | `text-3xl font-extrabold` (`text-2xl` on phones) |
| Now Playing's title | `text-3xl font-extrabold`, artist `text-base` |
| Section title (`SectionTitle`), dialog title | `text-xl font-bold` (About: `font-extrabold`) |
| Sidebar nav label | `text-base font-bold` |
| Body, row titles, menu items, buttons | `text-sm` (`font-medium`/`font-semibold`; buttons `font-bold`) |
| Secondary lines, times | `text-xs text-muted-foreground` |
| Overlines (track list header, "Music light") | `text-[11px] font-semibold uppercase tracking-wider` |
| A collection's kind | `text-xs font-semibold uppercase tracking-wider` |

- Times and counts are monospace with tabular figures (`Digits`,
  `src/components/ui/digits.tsx`), so they don't jitter as they count.
- Words that are only read can be selected and copied: Now Playing's title
  and artist, a collection's header, About. Rows and buttons cannot.

## Shape and spacing

### Radius

`theme.json`: `--radius` 8, `--radius-card` 12, `--radius-panel` 16,
`--radius-inset` 8. Nested radii are concentric: inner = outer − gap. A
sidebar panel (16) holds rows (8) at an 8pt inset; the player bar's 44pt
cover sits 14pt from every edge of its 72pt pill.

| Shape | Radius |
|---|---|
| Sidebar panels, dialogs, a bottom sheet's top | `--radius-panel` |
| Cards, popups, toasts, the mini player | `--radius-card` |
| Track rows, menu rows, tooltips | `--radius` |
| Sidebar rows and their sliding selection | `--radius-inset` |
| Buttons, icon buttons, search field, player bar | full (pill or disc) |
| Covers | `rounded-md`; round for artists and in the library; `rounded-2xl` in Now Playing |

### Spacing

- The page gutter is 12pt (`px-3`); content inside a section adds another
  12pt.
- The desktop shell keeps 8pt around and between the sidebar and the pages.
- A panel's inset is the same on every side (8pt), so a hovered row keeps
  clear of its border.
- List rows sit 4pt apart.

## Surfaces and elevation

- **Page**: `bg-sidebar`, flat. NSH's Linux navigation stack paints pages
  libadwaita grey, so every page is an `AppPage` (`src/components/page.tsx`),
  which covers it.
- **Panel**: `bg-card`, a 1px `border`, `--radius-panel`. No shadow.
- **Player bar**: an opaque `player` surface with a 1px `white/10` rim and
  `shadow-xl`, floating over the pages. Not glass: it does not sample what is
  behind it (that would cost a picture of the page on every scroll frame).
- **Popup**: `popupSurface` in `src/components/ui/controls.tsx`:
  `--radius-card`, `border`, `bg-popover`, `p-1`, `shadow-lg`.
- **Dialog**: `bg-popover`, `--radius-panel`, `shadow-2xl`, `max-w-md`, over a
  `shell/80` scrim.
- **Toast**: `bg-popover`, `border`, `--radius-card`, `shadow-xl`.
- Covers on cards and headers carry a soft shadow (`shadow-md`, `shadow-xl`).
- The library fades its rows out at the panel's bottom edge (an 8pt
  `card`-to-transparent fade) rather than cutting them.

## Layout

The shell is chosen by `layout()` (`src/components/layout.ts`): desktop,
phone or terminal. A desktop app keeps the desktop layout at any window size.

### Desktop

`src/shells/desktop.tsx`: the sidebar down the left, the pages on the right,
the player bar floating over the pages' bottom (`inset-x-3 bottom-1`).

| Window width | Sidebar |
|---|---|
| < 860 | Rail of icons and covers, 72 wide, each with a tooltip |
| 860–1100 | Open, 228 wide |
| > 1100 | Open, 274 wide; track lists gain an Album column |

- The sidebar is three panels: navigation (Home; Search too on the phone's
  drawer and the terminal), Your Library, and the account. The library has
  no visible title; the panel is labelled for screen readers.
- The header's first button folds the sidebar away entirely, at any width
  (remembered between runs). Folded, the user's picture moves to the header's
  top-left and opens the same menu downward.
- Pages end with room for the floating bar (`pageEnd()`: `pb-28`, `pb-36`
  stacked) so their last rows scroll clear of it.
- Crossing a breakpoint animates (`animateLayoutOn`); resizing between
  breakpoints follows the window at once.

### Title bar

`src/components/ui/title-bar.tsx`, `nsh.json` (`titleBar: hidden`, 40 high).

- **macOS and Windows**: the app draws its own 40pt bar across the top: the
  mark (18pt) and "Spotish" (`text-sm font-semibold`), clear of the traffic
  lights (left) or the caption buttons (right). The whole bar drags the
  window; double-click maximizes. It goes in full screen.
- **Linux** keeps the system's title bar (`installDesktopShell`,
  `src/platform/desktop.ts`); a tiling desktop such as Omarchy's Hyprland
  draws none, and the page header's ✕ closes the window.
- The phone's drawer keeps a brandless bar's room at its top; Now Playing
  puts its own top row under the window controls instead.
- Nothing on the web, phones or terminals.

### Page header

`src/components/header.tsx`, at least 56pt, inside the page on desktops:

Sidebar toggle · Back · Forward · (space) · Search · Premium · Close window

- **Search** is an icon that opens into a 288pt pill field (grows from the
  right, 240ms); on the Search page it stays open and results follow typing.
  Empty, it folds back on blur or Escape.
- **Premium** is a crown icon button with a tooltip, for free accounts, at
  every width. Signed out, it is a primary "Log in" button instead.
- **Close window** (✕) closes the main window as the title bar's would: it
  hides while the tray keeps the app, and the music plays on.
- Phones and terminals use the stack's header.

### Phone

`src/shells/phone.tsx`: one column, the mini player, and tabs (Home, Search,
Library). Library opens the whole sidebar as a left drawer (320 wide). iOS
and Android use the system's tab bar and header; the web draws its own tabs
on `player`. A browser page narrower than 640 gets this layout too.

### Terminal

`src/shells/terminal.tsx`: Cells and text. The sidebar's rows in the left
quarter, the page beside it, the player's two rows along the bottom; toasts
take the status line. No images, gradients, shadows or point widths:
icon-only controls show bracketed labels (`[Play]`, `[Prev]`), covers take no
Cells, the playing mark is ♪.

## Components

### Sidebar rows

Every row in the sidebar (Home, a library entry, the account) shares one
geometry: 44 high, padded 8, `--radius-inset`, its icon or cover in the same
30pt column, so labels line up. Rows are 48pt apart (44 + 4).

- Nav icons are 22pt; labels `text-base font-bold`, muted until selected.
- Library rows are one line: a round 30pt cover (36 in the rail; Liked Songs
  round too), the name, and the playing bars on the current row, whose name
  turns `primary`.
- Selection is one `secondary` background per panel that slides to the
  selected row (see Motion), not a background per row.

### Account menu

Opens up from the sidebar's foot (down from the header when the sidebar is
folded), exactly as wide as the account row (`accountMenuWidth()`: the
sidebar less the panel's 8 + 1 each side), so it lines up edge to edge.

- First, who is signed in: a 32pt avatar, the name, "Spotify Premium" or
  "Spotify Free".
- Rows: an icon centred in a 32pt slot (under the avatar's centre, labels
  under the name), the label, and ↗ for a page that opens in the browser, or
  a check for a setting.
- Order: Premium ↗ (free accounts), Spotify ↗ | About…, GitHub ↗, NSH ↗, FPS
  | Log out, Exit.

### Cards

`src/components/library/cards.tsx`.

- 144 wide in a row, padded 10, `--radius-card`; name `text-sm
  font-semibold` (one line), subtitle `text-xs` muted (two lines).
- **Golden play button**: the cover (card less padding: 124 in a 144 card) is
  φ³ times the button (29), and the button φ² times its inset from the
  cover's corner (11). Sized from the card's actual width, so it keeps the
  proportion in a widened grid card. A plain `PlayButton`: `background/80`
  disc, `shadow-md`, no border.
- Hidden at rest (down 12pt, 75%, transparent); rises in on hover; stays
  shown while that item plays.
- **Rows** scroll sideways, virtualized, 216 tall, snapping every 144pt to a
  card's start. The row runs out to the page's edges and insets its cards by
  the 12pt gutter, so every stop leaves that margin.
- **Grids** (an artist's discography) fill their row: as many columns as fit
  at 144 (`repeat(auto-fill, minmax(144px, 1fr))`), widened to share the row
  out, no room left at the end.

### Track rows

`src/components/library/tracks.tsx`: 48 high, `--radius`, inset 12 from the
page: number (24 wide; a play glyph on hover; the playing bars on the current
track), a 36pt cover, title and artists (an Explicit badge), the album above
1100pt, and the length (48 wide, `Digits`). Unplayable tracks at 45%.
The header row above them (32 high, a hairline under it) has no heading over
the numbers, a TITLE (and ALBUM) overline starting at the covers' edge, and a
14pt clock glyph over the lengths.

### Collection header

`src/pages/collection.tsx`: one band, not a hero. A 96pt cover, then kind
(overline), name, an optional description and a details line, then a 44pt
play button (48 on phones). The cover is centred over the rows' covers (the
header starts 30pt in). Phones stack it, centred, the cover up to 160 wide.

### Buttons

`src/components/ui/controls.tsx`.

- `IconButton`: borderless, a disc of size + 16 (18pt glyph, 34pt target).
  The glyph is at 70% and brightens on hover. A toggle that is on draws the
  glyph at full strength with a 4pt dot under it: `foreground` for the
  player's toggles (`tinted`: shuffle, repeat), `primary` elsewhere; Like
  turns `liked` instead, with no dot. Disabled at 30%. `hint` adds a tooltip, for
  icons whose meaning is not obvious.
- `PlayButton`: a disc, 36 by default (56 in Now Playing, 44/48 in a header,
  29 on a 144 card), glyph at 40% of it. Over pictures: `background/80` with
  `shadow-md`. `tinted`: a `foreground` 16% disc. `quiet` (the player bar,
  Now Playing): 8%, no border or shadow.
- `ActionButton`: a 36-high pill, `text-sm font-bold`. `primary` (one per
  area) is `bg-foreground`; `outline` is `bg-secondary` with a `border`.
- `TextLink`: `text-primary`, underlined on hover, for links that leave the
  app (the `link` role). "Button" means an action in the app.

### Sliders

`BarSlider`: the bar is the control, no thumb dot (it still takes focus and
screen readers). The range and the track share one centre line and keep one
height at rest and on hover. Track 8 high at `foreground/12`, range
`foreground/55`; `quiet` 6 high at `/8` and `/35`. The position's range is
drawn natively from an animated value, so it moves every frame with no JS. If
a thumb ever returns, never scale it: NSH centres it with a transform a scale
replaces.

### Player bar (desktop)

`src/components/player/player-bar.tsx`. A 72-high pill over the pages, the
music light inside it. Its layout follows the pages' width (the window less
the sidebar):

| Pages' width | Layout |
|---|---|
| ≥ 760 | **Full**: what plays (44pt round cover, title, artist) and Like on the left quarter; the transport over an inline position bar in the middle (up to 720); the volume (always open, 96) and the light menu on the right |
| 520–760 | **Compact**, one row: cover, title and Like on the left; the transport and the light menu on the right. No position or volume (Now Playing has both) |
| < 520 | **Stacked**, two rows, radius 36: cover, title and artist centred, and Like; under them the transport centred and the light menu at the end. Under a 560 window, shuffle and repeat go too |

- Controls are quiet: a faint play disc, thin faint sliders, 18pt icons.
- The light menu (✦) is always the last control on the right.
- The whole left block (cover, title, artist) opens Now Playing. During an
  ad it shows "Advertisement" and a "Get Premium" link and stays plain;
  seeking, skipping and Like are off.
- Hidden (unmounted) while Now Playing covers it.

The phone's mini player is a 56-high `secondary` card above the tabs: 40pt
cover, title, artist, a 36pt play button. It opens Now Playing.

### Now Playing

`src/components/player/now-playing.tsx`. A full-screen bottom sheet on
`bg-sidebar`, controls laid directly on the page: no floating card or glass.

- The music light is the page's background and lead, rising from the bottom
  up to about 45% of the window (each effect its own share of that).
- The cover takes the room the window leaves, up to 320, `rounded-2xl`,
  `shadow-xl`. Tall windows put it above the words; wide and short ones
  (≥ 640 wide, < 560 tall) beside them; with no room for a 96pt cover it goes.
- Below it: title (`text-3xl`) and artist with a 24pt Like; a thin, faint
  position bar with times under it; the transport (22pt icons, a 56pt quiet
  play disc).
- Top row, under the window controls (and dragging the window): a down
  chevron at the left closes it, back down into the bar, not "back" to a
  page. The volume (always open) and the light menu sit in the top-right.
- Escape, back, swipe down and the chevron close it.

### Menus

- Menu rows (`menuItem`): 32 high, `--radius`, padded 10, `muted` on hover
  and focus.
- Separators run edge to edge (`-mx-1`), 1px `border`.
- The light menu ("Music light"): 208 wide, one numbered row per effect (01
  to 14, monospace), the effect in use bold with a check on the right,
  scrolling above 288. Opens from the player bar (up) and Now Playing (down);
  one choice for both, remembered.

### Dialogs and sheets

`src/components/ui/overlays.tsx`, `src/pages/dialogs.tsx`.

- Dialogs (About, Log in to Spotify): centred, `max-w-md`, a ✕ at the top
  right. Escape, back and the scrim close them unless the flow forbids it
  (signing in closes only through Cancel).
- Sheets: the phone's drawer (left), Now Playing (bottom, full), the
  first-run sheet (bottom, `max-w-lg` content, top corners
  `--radius-panel`).

### Feedback

`src/components/ui/feedback.tsx`.

- Toasts: bottom right (bottom centre under 640), above the player (96pt on
  desktops, 140 on phones). Swipe right to dismiss; an action is a small
  `primary` pill.
- Loading: a skeleton shaped like the content (track rows, cards, the
  library, a collection's header) pulses, then gives way to the content
  (`Reveal`). Cached content shows at once, without a skeleton.
- Errors: one plain sentence (`text-lg font-bold`) and Retry ("Home didn't
  load."). Empty states: a short title and what to do.
- Work behind content that still shows: a 16pt spinner.

### Icons

`src/components/ui/icons.tsx`: [Tabler Icons](https://tabler.io/icons) 3.19
(MIT). Outline at a 1.5pt stroke; Filled for the transport (play, pause,
skip) and the heart. One family; a missing glyph comes from Tabler, never
drawn by hand. Drawn as SVG in a token's colour, redrawn when the appearance
changes. Sizes: 18 in controls, 22 for sidebar nav and Now Playing, 24 for
phone tabs, 16 in menus, 12–14 for marks (check, ↗, chevron).

The playing mark (`src/components/ui/playing.tsx`) is three bars drawn by a
shader, bouncing with the music's bass, mids and treble; short and still when
paused or with reduced motion.

### Logo

`src/ui/logo.tsx`: three rounded bars of a level meter, near-black, on a
glossy green tile (`#5ff08f` → `#1ed760` → `#14833b`, a soft top gloss). The
app, the website's favicon and header draw the same mark; the tray draws the
three bars alone in the panel's text colour. Beside a title and subtitle it
is as tall as both lines (44); in the title bar, 18.

## The music light

`src/components/ui/toolbar-fx.tsx` (`PlayerGlass` in the bar, `MusicLight`
in Now Playing).

- **Colour from the cover.** A palette is extracted from the cover
  (`coverColorsQuery`); each effect takes the first three, repeating them
  when the cover has fewer, and they travel round the light every 24s.
  Before a cover's colours are known, `primary`.
- **Held dark.** `tame()` keeps the hue and holds luminance near 0.32 (capped
  at 0.9 per channel), so the light never hurts the controls' contrast.
- **Driven by the music.** Every effect has crests: louder bands rise as
  peaks, the beat swells them. Edges are smooth. Lines are crisp: a thin
  bright core in a soft glow, never only a blur. Unmetered (macOS, the demo),
  a resting level keeps it alive.
- **Fourteen effects**, in menu order: Dots (default), Grid, Wave, Orb,
  Spectrum, Bars, Ribbons, Halo, Aurora, Mountains, Mesh, Particles, Strings,
  Current. Current (arcs of electricity between drifting electrodes) keeps
  its cores white (a light grey under the controls' white) and only their
  narrow rims in the cover's hue. Above them, Random picks another effect
  for each track.
- **Bounded.** Each effect has its own height in Now Playing (terrains,
  Orb and Aurora fill the room; lines take about half) and never reaches past
  the top of its strip.
- **At rest** when nothing plays and with reduced motion: the shader pauses.

## Motion

### Tokens

`src/components/ui/tokens.ts`; change a value there, not in a component.

| Token | Value | For |
|---|---|---|
| `instant` | 120ms | A hover wash, a colour change |
| `fast` | 180ms | A control's hover and press layers |
| `base` | 240ms | Moving into place: a menu leaving, a selection sliding, an icon swap, a breakpoint |
| `slow` | 360ms | Reveals, a menu opening, the like pop, a label morph |
| `slower` | 520ms | Unhurried entrances |
| `SMOOTH_OUT` | `cubic-bezier(0.22, 1, 0.36, 1)` | Presses, list waves, cover flips |
| Distances | 4 / 8 / 16 | Label rise / menu slide / search field, list items |
| Scales | press 0.95, pressSoft 0.97, enter 0.9, swap 0.25 | |

### Controls

- Every interactive control has layered feedback: a translucent wash, a
  press, and its icon moving once.
- Hover brings only a wash (or a slightly deeper shadow) in, 120ms ease-out;
  never a grow. A press takes a whole button to 0.97 (an icon button's disc
  and glyph to 0.95) over 180ms on `SMOOTH_OUT`, and the wash deepens.
- A labelled button's new label rises 4pt as it fades in (360ms).
- A glyph that changes (play/pause, repeat, the volume's levels, mute) swaps
  (`SwapIcon`): the old one shrinks to 0.25, blurs 2px and fades as the new
  one grows and sharpens, 240ms ease-in-out. NSH can't animate a blur, so it
  steps four times; nothing runs at rest. A glyph that only changes colour
  fades over 180ms.
- Icon hover motion follows the glyph's own shape and plays once per entry:
  skip leaves an echo, shuffle's lines cross, repeat's arrows turn, the
  volume's waves come in one by one, the heart beats. Small; no big presets.
- Cards don't lift or resize: a wash comes in, the cover grows 1%, the play
  button rises over it.

### Like

transitions.dev's "Like button": the heart squashes to 0.82 and springs back
past its size (360ms, `cubic-bezier(0.34, 1.96, 0.64, 1)`) while 8 `liked`
dots spray out about 20pt, each with its own angle, reach, size and delay
(about 600ms). Only the user's own press that turns Like on plays it;
unliking dips the heart (0.95, 180ms). Nothing plays on a track change.

### Lists and loading

- Skeletons pulse (each shape to half opacity and back, 1s ease-in-out),
  then fade out as the content fades in over them, 360ms ease-in-out (the
  reference's cross-blur is left out).
- Rows (tracks, the library) enter in an irregular wave, top to bottom: each
  fades in from the right (12–20pt), passing its place by 1pt before it
  settles, over 405–475ms on `SMOOTH_OUT`. Turns are 55ms apart for the first
  12 rows; each adds a fixed lag of up to 90ms, so neighbours can trade places
  while the wave still flows. Cards rise the same way, left to right, the
  first 8 taking turns; Home's sections start 55ms apart. The scatter is a
  hash of the item's place: the same on every render.
- Each cover flips open (`flipInY`, from −90° past 8° to rest, under a 600pt
  perspective), 120–220ms after its row or card, over 330–550ms.
- The wave plays every time a page is entered (opened, returned to, shown
  from cache); loaded content starts as the skeleton is half gone. Items
  scrolled into view later come in on their own with up to 60ms jitter. Each
  item comes in once per entry; a recycled cell, a re-render or a playback
  tick plays nothing. Shared code: `WAVE`, `createListWave`,
  `listItemEntrance` in `src/components/ui/motion.ts`.

### Surfaces

- **Sidebar selection**: transitions.dev's "Tabs sliding". One background per
  panel slides to the selected row (240ms ease-in-out). In the library it
  follows the list's scroll natively and is clipped by the panel. With no
  selection in a panel it fades away; between panels one fades out as the
  other fades in.
- **Menus**: transitions.dev's "Dropdown menu morph" (`src/components/ui/menu.ts`).
  The popup grows out of the trigger's nearest corner, slid 8pt toward it,
  from 0.97 and 2px blur, fading in over 360ms on
  `cubic-bezier(0.34, 1.25, 0.64, 1)`; it leaves the same way in 240ms without
  the overshoot.
- **Dialogs** rise 10pt from 0.97 and fade in (240ms) as the scrim fades.
  **Toasts** slide up in and out to the right.
- **Navigation** follows history: a page already in the stack animates back,
  a page ahead forward. Sidebar switches cross-fade.
- **Breakpoints** (`animateLayoutOn`): what moves glides, what comes or goes
  fades, 240ms ease-in-out. Not on every resize.
- **A new track**: the cover settles in with a small overshoot (420ms), the
  words rise after it (320ms, 80ms later).
- **Now Playing opens** in layers: the cover zooms in, then the words, the
  position and the transport rise one after another.

### Reduced motion

Everything respects it: transitions become instant, waves and swaps don't
play, menus appear at once, breakpoints jump, and the music light and the
playing bars rest.

## Words

- Short, sentence case. Menu items say only what they are: Premium,
  Spotify, About…, GitHub, NSH, FPS, Log out, Exit. "…" marks an item that
  opens a dialog; ↗ one that opens the browser.
- Say "Spotify", not "spotify.com". Log in / Log out, not sign in.
- Errors are one plain sentence ("Your library didn't load.") with Retry.
- Accessibility labels say what a control does ("Save to Liked Songs",
  "Close Now Playing", "Collapse sidebar").
- The tray menu: "Open Spotish"; then what plays (its title, Play/Pause,
  Next track, Previous track, Show Now Playing); then Exit. Exit, in the tray
  and as the user menu's last row, ends the app and the music.

## Performance

- Anything that can grow is a virtualized `List`: the library, a
  collection's tracks, Home's sections and every row of cards. Only what is
  near the view exists.
- Lists of equal items snap (`snapToInterval`, `snapToAlignment="start"`): a
  card row at a card's start, the library at a whole row. A list under a
  header of unknown height (a collection's tracks) does not snap.
- Pictures load at the size they show: covers up to 40pt ask Spotify for the
  64px variant (`src/data/images.ts`).
- Nothing redraws every display frame without need. Shaders take their clock
  from native animated values, never `nsh.time` (which repaints the whole
  window at the display's rate), and pause with the music. The levels reach
  the visuals at about 60 frames a second.
- Draw only where the light is (the bottom strip of Now Playing), never
  sample a backdrop, and unmount what is hidden (the player bar under Now
  Playing). Now Playing must hold the display's refresh rate.

## Obligations

Not style, and never traded away: Spotify's ads play and are never blocked or
skipped; Premium is always offered to free accounts; the unofficial
disclaimer ("Spotish is an unofficial client and is not affiliated with
Spotify.") stays in About and the first-run sheet; NSH is credited.
