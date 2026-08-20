# Gallery download speed — analysis and options

> **Status: analysis only. Nothing here is implemented.**
> Written while reviewing the "download all folders" feature on the no-watermark
> gallery link. Parked for a future session.

## Why this exists

The download-all-folders feature works, but downloads feel slow next to commercial
galleries (Pixieset, SmugMug, ShootProof). This records what the bottleneck actually
is, so the fix can be chosen deliberately rather than guessed at.

## What the code does today

`executeZipDownload` in `src/components/Gallery/PhotoGalleryView.tsx` fetches photos
**strictly one at a time**:

```
for each folder:
  for each photo:
    await fetch(url)      ← next photo doesn't start until this one finishes
    await res.blob()
    zip.file(name, blob)
await zip.generateAsync({ type: 'blob' })
```

Two separate problems fall out of that:

1. **One request in flight at a time.** Every photo pays a fresh round trip to
   Firebase Storage (~50–150ms) *plus* TCP slow-start, and a single connection
   almost never saturates a fast line. On a good connection the link sits mostly
   idle, waiting on round trips rather than transferring.
2. **The archive lives in memory twice.** JSZip holds every blob, then
   `generateAsync({ type: 'blob' })` builds another complete copy. Roughly 300
   originals at ~6MB each is ~1.8GB held and ~3.6GB at peak — and nothing reaches
   disk until the very end, so the browser is silent for minutes, then stalls on
   "creating archive", then finally produces a file.

Worth keeping as-is: `compression: 'STORE'` (JPEG/MP4 don't deflate), per-photo
error tolerance, and reuse of `loadedPhotosCache` so already-opened folders aren't
re-fetched.

## Options, ranked by gain per unit of risk

### A. Parallel fetching — biggest win, smallest change

Replace the serial loop with a bounded worker pool (6–8 concurrent fetches), writing
into a pre-sized array to preserve order. Firebase Storage speaks HTTP/2, so
concurrent requests multiplex over one connection efficiently.

- **Expected:** ~3–5× on a fast connection; less when the line is already the limit.
- **Risk:** low — contained to one function, no new dependencies.
- **Watch out:** progress must count completions, not loop index.

### B. Stream to disk instead of buffering — biggest *perceived* win

Use the File System Access API (`showSaveFilePicker` → `WritableStream`) with a
streaming zip writer such as `client-zip`, so bytes land on disk as they arrive.
Memory stays flat, the file starts growing within seconds, and the final pause
disappears. Would also make the 300-file warning dialog unnecessary.

- **Expected:** constant memory; very large galleries stop being risky.
- **Risk:** medium — new dependency, and `showSaveFilePicker` is Chromium-only, so
  the current JSZip path has to stay as a fallback. Acceptable given this is the
  photographer's own private link.

### C. Server-side archive — how the commercial services actually do it

There is already a Node process in production (`server.js`, currently only a static
SPA file server; `firebase.json` declares no Cloud Functions). It could expose an
endpoint that streams a ZIP via `archiver`, reading from Storage at datacenter
bandwidth. The client then makes **one** sustained download instead of 300 requests.

Better still: build the archive **once when uploads finish**, store it beside the
gallery, and have "download all" hand over a direct link — instant, resumable,
cacheable. This is essentially the Pixieset model.

- **Expected:** fastest possible, and the only genuinely resumable option.
- **Cost:** real infrastructure work — egress budget, request timeouts on whatever
  hosts `server.js`, and roughly double storage if archives are pre-built.

### D. Small refinements

`res.arrayBuffer()` instead of `res.blob()`, and `generateAsync({ streamFiles: true })`,
each shave a little memory. Marginal next to A and B — only worth doing alongside them.

## Recommendation

**A first.** Small, self-contained, and the largest gain for the effort.
**B next** if large galleries are still painful; together they take client-side
downloading to roughly its ceiling.
**C only** if this needs to match the commercial services outright — treat it as an
infrastructure project, not a tweak.

**What will not help:** downloading `previewCleanUrl` instead of `cleanUrl` would be
much faster, but delivers ~1200px web copies rather than print originals — which
defeats the purpose of the no-watermark link.

## Verification (whichever option is chosen)

1. Time a real multi-folder gallery before and after, same connection, cleared cache.
2. Watch browser task-manager memory during an all-folders run.
3. Confirm the unzipped archive matches the current one in file count and folder
   structure.
4. Re-check the public link: single action, email gate intact, watermarks applied.
5. `npx tsc -b --noEmit` and `npx vite build` clean.
