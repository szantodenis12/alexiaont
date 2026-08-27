# Plan: grid settings per folder in photo galleries

> **Status: plan only. No code has been changed.**

## Goal

Reproduce all four Pixieset grid controls — **Grid Style, Thumbnail Size, Grid
Spacing, Navigation Style** — but on a **folder-by-folder** basis, editable from the
gallery editor in the admin. Pixieset only offers these for a whole gallery; the
point of this work is that "Ceremonie" can look different from "Portrete" inside the
same gallery.

**Settled with the client:**
- All four controls, not a subset.
- A **gallery-level default**, which each folder may override.
- The client photo-selection page must match the gallery.

## What exists today

Photos render as a **masonry column layout** in `PhotoGalleryView.tsx`:

- `columnsCount` is purely responsive — 5 / 4 / 3 / 2 by window width (`:133`)
- `distributePhotos()` packs photos into the shortest column by aspect ratio (`:1070`)
- Gap is hardcoded: `columnsCount > 2 ? '4px' : '3px'` (`:1584`)
- Folder navigation is **text tabs** (`folders-nav-wrapper`, `:1296`)

There is no layout setting anywhere today — not per gallery, not per folder.

Two facts make this cheaper than it looks:

**Folder metadata already persists new fields automatically.** Every writer saves
folders as `({ photos, ...meta })` — `PhotoGalleryCreator.tsx:185`, `:1152`, `:1408`.
New `SubCollection` fields flow through all existing save paths untouched. No
migration, no changes to those writers.

**Aspect ratios are already stored.** `PhotoItem` has `width`/`height`
(`PhotoGalleryView.tsx:17`), which is exactly what a justified layout needs.

One complication: **`GallerySelector.tsx` duplicates the masonry code** (`:102`,
`:118`, `:140`, `:741`). Since the selection page must match, the layout should be
extracted into one shared module rather than duplicated a third time.

## Data model

Gallery-level defaults on `GalleryData`, with optional per-folder overrides on
`SubCollection`:

```ts
interface GridSettings {
  gridStyle: 'vertical' | 'horizontal';
  thumbnailSize: 'regular' | 'large';
  gridSpacing: 'regular' | 'large';
}

interface GalleryData {
  // ...existing
  gridDefaults?: GridSettings;
  navigationStyle?: 'text' | 'thumbnails';   // gallery-wide, see note below
}

interface SubCollection {
  // ...existing
  grid?: Partial<GridSettings>;   // absent = inherit gallery default
}
```

Resolution order per folder: `folder.grid?.x ?? gallery.gridDefaults?.x ?? current
behaviour`. Everything optional, so existing galleries render exactly as they do now
with nothing stored.

### Note on Navigation Style

The other three settings describe how *photos in a folder* are laid out, so per-folder
is natural. **Navigation Style describes the folder switcher itself** — the strip
listing all folders — which is shared chrome. A per-folder value would be
self-contradictory: folder A saying "text" and folder B saying "thumbnails" for the
same shared control.

So it is modelled as **gallery-level only**. The two options mirror the screenshot:
text tabs (today's behaviour) or thumbnail tiles using each folder's first photo.
Flagging this rather than silently making it per-folder.

## The four settings

**Thumbnail size** — a modifier on the responsive column count, never an absolute
number, so mobile stays usable:

| Width | Regular | Large |
|---|---|---|
| > 1200px | 5 | 3 |
| > 900px | 4 | 3 |
| > 600px | 3 | 2 |
| ≤ 600px | 2 | 1 |

**Grid spacing** — replaces the hardcoded gap. Regular keeps 4px/3px; large is
roughly 16px/10px.

**Grid style** — `vertical` is the existing masonry. `horizontal` is **justified
rows**: photos packed into rows scaled to fill the width at a uniform row height,
using stored aspect ratios. A genuinely different algorithm and the largest single
piece of work here.

**Navigation style** — folder switcher as text tabs (today) or thumbnail tiles.

## Admin UI

Layout settings belong to the **selected folder**, and the editor sidebar already has
folder selection, so the panel goes in the existing **"Poze"** settings tab, headed
with the active folder's name so it is obvious the settings are per folder.

- Two-option pickers reuse the existing segmented control (`.ad-seg` in `index.css`)
- Each control shows whether it is **inherited** from the gallery default or
  **overridden** for this folder, with a "reset to gallery default" affordance
- Gallery defaults and Navigation Style live in a separate small section, since they
  apply to the whole gallery
- An **"apply to all folders"** action, since the intent is often uniform
- Saving goes through the existing autosave path that already persists
  `subCollections`

## Phasing

**Phase 1 — shared layout module.** Extract the masonry into one module used by both
`PhotoGalleryView` and `GallerySelector`, with settings passed in. Pure refactor, no
visible change. Everything else builds on this.

**Phase 2 — thumbnail size + spacing.** Parameter changes to the extracted masonry.

**Phase 3 — admin UI.** Per-folder panel, gallery defaults, inheritance display,
"apply to all folders".

**Phase 4 — horizontal / justified layout.** The new algorithm, in the shared module
so both viewers get it at once.

**Phase 5 — navigation style.** Thumbnail folder switcher as an alternative to tabs.

Phases 1–3 deliver a working, useful feature on their own; 4 and 5 extend it.

## Risks

- The shared-module extraction touches both viewers — the phase most able to break
  something visible, which is exactly why it goes first and alone.
- Column counts must stay responsive; "large" on a phone cannot mean 5 columns.
- Folders with no stored settings must render byte-identically to today.
- Justified rows need a sensible fallback when `width`/`height` are missing on older
  photos — the existing `aspectRatios` state already covers this.

## Verification

1. Before touching any setting, every existing gallery and folder looks unchanged.
2. Changing one folder affects only that folder, not its siblings.
3. Clearing a folder override makes it follow the gallery default again.
4. Settings survive reload, and survive adding/deleting/reordering photos — the
   shared `({ photos, ...meta })` writers are the thing to watch.
5. Every breakpoint at both thumbnail sizes, especially mobile.
6. The client selection page matches the gallery for the same folder.
