# Reader v1.26.4

Point release based directly on Reader v1.26.

Changes in the v1.26 point-release line:
- Render the local IndexedDB library before Dropbox startup sync, so network sync no longer delays the visible app.
- Keep the app grid constrained to the viewport so the sidebar footer stays visible regardless of article count.
- Use a compact one-line article drag preview so folder names remain visible while dragging.
- Highlight the current folder drop target more clearly.
- No splash/hydration overlay was added.

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


## Reader v22

- Replaced interface glyphs with Lucide icons and refreshed the Reader app icon in the same visual family as Studio and Notes.
- Added draggable desktop navigation and article-list column widths; double-click either divider to reset.
- Added explicit click/tap page turning on the left and right sides of the desktop paged reader while preserving text selection and links.
- Applies the saved reading theme before the stylesheet paints, eliminating the Light-to-Dark startup flash on devices that already have a saved theme.
- Removed duplicate pagination on article open and the cloned-image repagination feedback loop that could cause repeated mobile flicker. Late article images now trigger at most one guarded repagination from the canonical article.


## Build

- Visible sidebar build number: `Reader v1.26`.


## Reader v23

- Desktop paged reading now uses the full outer reading margins as page-turn targets, so the pointer can stay outside the article text.
- The active edge zones are slightly wider (38% left / 38% right), while the central 24% remains neutral.
- Footer controls, links, form controls, and text selection remain protected from accidental page turns.


## Reader v24

- Fixed the iPad Back button. At the tablet breakpoint it now returns to a full-width article list instead of calling the phone-only close behavior.
- Added a Lucide full-screen reading button to the article toolbar on tablet and desktop. It hides navigation and the article list so the article uses the full Reader window.
- The same button exits full-screen reading; Escape also exits it on desktop.
- On phones, Reader already uses the full app window for an open article, so the extra full-screen button stays hidden.


## Reader v25

- iPad reading-width choices now use more distinct measures: Narrow 520 px, Medium 620 px, Wide 820 px. Existing 600/700 px settings migrate automatically.
- Added a dedicated Lucide hide/show article-list control beside the Back arrow on iPad. Hiding the list expands the article to the full Reader window.
- The desktop full-screen reading control remains in the right toolbar; on iPad the new panel control occupies the less crowded left side of the reader toolbar.
- Updated the PWA cache to v25 so the new interface is not masked by an older cached build.


## Reader v26

- Added reading-font choices: Lora, Playfair Display, Literata, Bookerly, Cormorant Garamond, Crimson Text, Lancelot, and Lyon.
- Lora, Playfair Display, Literata, Cormorant Garamond, Crimson Text, and Lancelot are loaded as web fonts.
- Bookerly and Lyon use local installed/licensed copies when available and otherwise fall back to a book-oriented serif stack; no proprietary font files are bundled.
- Updated the PWA cache to v26.


## v1.26.4
- Added an **All Articles** view showing every non-archived article regardless of folder.
- All Articles opens sorted by **Newest**.
- The list shows a subtle folder (or Inbox) label so you can see where each article is filed.
