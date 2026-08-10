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

## Storage

Reader remains local-first in IndexedDB. Optional Dropbox sync can mirror the article library, folders, favorites/archive state, reading position, and Reader settings between connected browsers. Article-image caching remains device-local.


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


## Version 8
Fixes a reading appearance bug where changing font or font size could save line spacing as 0 and make lines overlap. Existing bad settings are repaired automatically.

- Reorder folders manually by dragging, or sort folders A–Z.


## Reader v12

Article cleanup now preserves extracted text even when source sites use hidden/opacity/layout attributes, with a plain-text fallback if cleaned HTML is unexpectedly empty. Folder sorting and drag/drop remain unchanged.


## v14 reliability fix
- Restores the missing folder editor dialog expected by the JavaScript.
- Prevents optional folder UI from aborting application startup.
- Uses one canonical article body for Scroll and Paged modes.
- Adds a plain-text safety fallback for captured articles whose source HTML cannot be rendered reliably.


Reader v15: pagination now fills the first page correctly and keeps a bottom safety margin so lines are not clipped.

## Reader v16

- Paged mode now labels the footer as `Page x of y`.
- Optional Dropbox sync uses OAuth 2 + PKCE and stores the library in `/reader.json` inside the Dropbox App Folder.
- Dropbox sync includes articles, folders, favorites/archive state, reading progress, and Reader appearance/settings. The app remains local-first.
- To connect the hosted GitHub Pages build, add its exact URL (for example `https://mojocolony.github.io/reader/`) as an OAuth redirect URI in the Dropbox App Console, then paste the app key in Reader Settings.
