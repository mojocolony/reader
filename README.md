# Reader

A personal read-it-later web app with both paged and scrolling reading modes.

## Version 1

- Save articles with the **Save to Reader** bookmarklet
- Uses Mozilla Readability when the source page permits it
- Paged reading with Previous/Next, arrow keys, Page Up/Page Down and touch swipes
- Scroll reading mode
- Font, size, line spacing, width, and Light/Sepia/Dark/E-Ink themes
- Inbox, Favorites, Archive, folders, search and sorting
- Local IndexedDB article storage
- Best-effort offline image caching
- JSON backup export/import
- PWA support

## GitHub Pages

Upload the files in this folder to the root of a public GitHub repository and enable Pages from the `main` branch, `/ (root)`.

After hosting, open **Settings** inside Reader to install the bookmarklet. The bookmarklet automatically points to the URL where this copy of Reader is hosted.

## Current limitation

Version 1 is browser-local. It does not yet sync the article library between devices. Dropbox sync is a natural next addition once the reading/capture experience is approved.


## v2 fix

- Fixed article selection so the empty reading-queue screen properly hides when an article opens.


## v4
- Mobile paged reading now clips to exactly one centered page width, preventing adjacent columns from showing.


## v5
- Fixed mobile/tablet paged-reading column width mismatch caused by horizontal padding.
- Page advance now measures the actual content-box width defensively.


## v6
Paged mode now uses viewport scrolling instead of CSS transforms, avoiding iOS Safari stale-text repaint artifacts when changing font size or typeface.


## Reader v7 pagination

Paged mode uses explicit single-page DOM containers instead of CSS multi-column layout. This avoids WebKit/iOS repaint and reflow glitches when changing fonts or font sizes.
