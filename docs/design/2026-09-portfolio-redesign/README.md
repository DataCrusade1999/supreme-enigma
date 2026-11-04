# Portfolio redesign explorations (2026-09)

Design explorations for the public portfolio pages (`web/app/(site)/`). Nothing here is implemented yet; the live site still uses the current design.

Live canvas: https://claude.ai/artifact/9YyicTysfos35P9ZbN6dE3 (private to the owner).

`canvas/` is a snapshot of that canvas's source files, so the work survives even if the artifact does not. The `.dc.html` files are Design Component pages: they need the canvas runtime (`./support.js` is served by the canvas, not this repo) and will not render if opened directly. To restore or fork the canvas, publish these files back into a Design canvas under `project/`, with `canvas.json` as the index.

## What is on the canvas

**Page "Explorations"**

| Board | File |
|---|---|
| Design system ("Datasheet") | `DesignSystem.dc.html` |
| Theme comparison | `Themes.dc.html` |
| BGM Looper project page | `Project.dc.html` |
| Home, desktop — Paper, Midnight, Forest, Cobalt, Clay | `Main.dc.html`, `HomeMidnight.dc.html`, `HomeForest.dc.html`, `HomeCobalt.dc.html`, `HomeClay.dc.html` |
| Home, mobile — Paper, Midnight, Clay | `Mobile.dc.html`, `MobileMidnight.dc.html`, `MobileClay.dc.html` |

**Page "Cobalt & Midnight — serif"**: Cobalt and Midnight with Forest's typography (Fraunces headings), desktop and mobile — `HomeCobaltSerif.dc.html`, `HomeMidnightSerif.dc.html`, `MobileCobaltSerif.dc.html`, `MobileMidnightSerif.dc.html`.

`Main.dc.html` and `Mobile.dc.html` hold the actual layouts and a `theme` prop; every other home/mobile board imports one of them with a different theme, so copy edits happen in those two files only.

## Content decisions

- The home page leads with the person, not the tools. BGM Looper is one entry in "Selected work", described as a side project.
- DevOps/cloud, telecom (LTE core such as Magma EPC, eNodeB and the RAN), networking and audio/DSP are listed only as interests in the About section.
- Bracketed text (`[City, Country]`, `[Project name]`, `[your@email]`, bio lines) is placeholder copy still to be written.

## Themes

Body text is IBM Plex Sans and data/labels are IBM Plex Mono in every theme. Contrast ratios are WCAG, measured against the ground colour.

| Theme | Ground | Surface | Ink | Muted | Accent | Link | Display face | Ink / muted / link |
|---|---|---|---|---|---|---|---|---|
| Paper | `#F4F1EA` | `#FBFAF6` | `#16181D` | `#5A5F6A` | `#D2451E` | `#B53A17` | Bricolage Grotesque 700 | 15.7 / 5.7 / 5.2 |
| Midnight | `#0F1115` | `#171A21` | `#E9EAEE` | `#9AA0AC` | `#7CE0B5` | `#7CE0B5` | Space Grotesk 700 | 15.7 / 7.2 / 11.9 |
| Forest | `#EEF0E8` | `#F7F8F3` | `#14231B` | `#4F5E55` | `#2F6B45` | `#2F6B45` | Fraunces 600 | 14.2 / 6.0 / 5.5 |
| Cobalt | `#F2F5FA` | `#FFFFFF` | `#0E1A33` | `#4B5873` | `#1F4FD8` | `#1F4FD8` | Space Grotesk 700 | 15.8 / 6.5 / 6.1 |
| Clay | `#1C1714` | `#26201C` | `#F2E8DC` | `#B3A596` | `#E8895B` | `#F0A07A` | Fraunces 600 | 14.7 / 7.4 / 8.5 |

`midnightSerif` and `cobaltSerif` use the Midnight and Cobalt colours with Fraunces 600.

Shared rules: square corners, 1 px hairlines and a 2 px ink rule under section headings instead of cards and shadows, mono section indices (`01 — Selected work`) in the accent colour, 4 px spacing base, 12-column grid with 80 px page margins on desktop and 16 px on mobile.

## Open decisions

- Pick one theme (current front-runners: Cobalt serif and Midnight serif).
- Write the placeholder copy.
- Decide whether the BGM Looper project page keeps the "Datasheet" look or follows the chosen theme.
