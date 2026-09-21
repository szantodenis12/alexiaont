# Audit: de ce se încarcă greu galeriile

> **Stare: Etapa 1 implementată (21.09.2026). Etapele 2 și 3 — doar plan.**
> Măsurători făcute pe datele reale (28 de galerii) și pe site-ul live
> `alexiaont.com`.

## Concluzia scurtă

Problema nu vine de la server, de la regiunea bazei de date (`eur3`, Europa) și
nici de la calitatea datelor — toate pozele au variantă redusă și dimensiuni
salvate. Vine din **cât se descarcă odată**: pagina așteaptă toată lista
folderului înainte de prima poză, editorul din admin încărca toate imaginile
simultan, iar fișierele urcate recent nu se păstrau în cache între vizite.

## Ce am măsurat

| Element | Valoare |
|---|---|
| Lista unui folder de 1.157 poze (Sonia → PARTY) | 2,65 MB de date, ~9 s, înainte de prima poză |
| Mărimea unui document de poză | 2,4 KB (4 URL-uri + 4 căi; gridul folosește unul) |
| Deschidere editor admin (Sonia / Bogdan x Florina) | 2.578 / 3.378 documente, toate deodată |
| Imagini la deschiderea unui folder în editor | toate simultan, fără lazy loading (~130 MB la 1.157 poze) |
| Copertă | 1,3 – 5,2 MB (originalul); niciuna din 28 nu are variantă redusă |
| Miniatură în grid | 70 – 180 KB (1200px, afișată la 200–400px) |
| Cache pe fișierele noi din Storage | `private, max-age=0` |
| JavaScript principal pe site-ul live | 858 KB necomprimat |

## Cauzele, în ordinea impactului

1. **Galeria clientului așteaptă tot folderul** — `PhotoGalleryView.tsx`,
   `fetchPhotosForSub`: un singur `getDocs` pe tot folderul.
2. **Editorul din admin descarcă totul** — `PhotoGalleryCreator.tsx` încarcă
   toate folderele la deschidere; grila nu avea `loading="lazy"`.
   `GallerySelector.tsx` încarcă și el toate folderele (dar randează treptat).
3. **Fișierele nu rămâneau în cache** — niciun upload nu seta `cacheControl`.
4. **Coperta este originalul** — `coverPhoto.url`, 1,3–5,2 MB.
5. **JavaScript-ul pleca necomprimat** — nici `server.js`, nici Cloud Run nu comprimau.
6. **Încărcare în serie** — galerie → poze → setări, spinnerul aștepta toate trei.
7. **Miniaturi mai mari decât e nevoie** — 1200px pentru căsuțe de 200–400px.

## Etapa 1 — implementată

- **Compresie în `server.js`** (brotli / gzip, doar formate text, memorată per
  fișier). Testat local: bundle-ul principal 863 KB → 235 KB, conținutul
  decomprimat identic byte cu byte; imaginile nu sunt comprimate.
- **`cacheControl` de un an la upload** — `src/utils/storageCache.ts`, aplicat
  doar pe căi unice (conțin timestamp + sufix aleator): upload galerii și clase
  din `UploadContext`, regenerarea miniaturilor și înlocuirea originalului din
  editor.
  **Exclus intenționat:** re-aplicarea watermark-ului din editor, care scrie
  `wm_<fișier>` la aceeași adresă — un cache lung ar arăta watermark-ul vechi.
- **`loading="lazy"`** în grila editorului de galerii.
- **Setările fotografului cerute în paralel** cu galeria în `PhotoGalleryView`.

**Rămas din Etapa 1:** cache pentru fișierele deja existente în Storage.
Recomandat doar pe miniaturi (`prev_*`, `prevwm_*`), care nu se suprascriu
niciodată. Nu pe `wm_*`.

## Etapa 2 — cel mai mare câștig pentru clienți

- Paginare în galerie: primele ~60 poze (după `order`), restul în fundal.
- Editor și pagina de selecție: încărcarea doar a folderului deschis.
- Copertă redusă (~2000px) generată la setarea copertei, cu originalul ca rezervă.

## Etapa 3 — doar dacă mai e nevoie

- Variantă de miniatură ~600px la upload + regenerare pentru pozele existente.

## Ce NU va ajuta

- Un plan Firebase mai scump sau mutarea bazei — regiunea e deja în Europa.
- Ștergerea pozelor vechi — contează cât se cere odată, nu mărimea totală.

## Cum verificăm

Chrome DevTools → Network, galeria Sonia → PARTY, înainte și după, o dată cu
„Disable cache” bifat și o dată debifat. Ținta: primele poze vizibile în sub
2 secunde; la a doua vizită, aproape nimic descărcat din nou.
