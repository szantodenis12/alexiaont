# Plan: de ce se încarcă greu panoul de administrare

> **Stare: doar analiză. Nu s-a modificat niciun rând de cod.**
> Investigație făcută pe codul live, după mutarea pe Firebase Hosting.

## Concluzia scurtă

Încetineala **nu vine din rebrandingul vizual** și nici din mărimea totală a
storage-ului. Vine din felul în care panoul citește datele la pornire.

Cea mai gravă problemă: pentru a afișa numărul de poze de pe fiecare card de
galerie, aplicația **descarcă efectiv fiecare document de poză** din fiecare
folder al fiecărei galerii. Nu citește un număr — citește toate pozele, ca să le
numere. De asta devine tot mai lent pe măsură ce adaugi galerii: costul crește
direct cu numărul de fotografii din platformă.

---

## Ce am măsurat

| Element | Situația actuală |
|---|---|
| Chunk JavaScript principal | 854 kB (259 kB comprimat) |
| Chunk-ul panoului de admin | 172 kB (39 kB comprimat) — mic, nu el e problema |
| Numărare poze galerii | **descarcă toate documentele de poze**, la fiecare încărcare |
| Listener „submissions” | fără limită — toate albumele din toate clasele |
| Listener „downloads” | fără limită — tot istoricul de descărcări, dintotdeauna |
| Documentele de clasă | conțin lista de poze inclusă în document |
| Antete de cache pe Hosting | **neconfigurate** (nu există secțiune `hosting` în `firebase.json`) |
| Antete de cache pe Storage | **nesetate** la upload → implicit doar 1 oră |

---

## Cauzele, în ordinea impactului

### 1. Numărarea pozelor descarcă toate pozele — cauza principală

`AdminDashboard.tsx`, funcția `fetchCountsForGalleries`: pentru fiecare galerie
și fiecare folder rulează `getDocs()` pe întreaga subcolecție de poze, apoi
numără rezultatele. La ~1000 de poze în platformă, asta înseamnă **peste 1000 de
documente descărcate la fiecare deschidere a panoului**, doar ca să afișeze
niște numere.

În plus, când numărul calculat diferă de cel salvat, funcția **scrie înapoi** în
Firestore — deci fiecare încărcare generează și scrieri.

Acesta este și motivul pentru care problema se agravează în timp: costul crește
proporțional cu numărul de fotografii, nu cu numărul de galerii.

**Soluție:** Firestore are `getCountFromServer()`, care returnează doar numărul,
fără să descarce documentele. Numărul este deja salvat în `photoCount` pe
fiecare folder, deci în majoritatea cazurilor nici măcar nu trebuie recalculat —
se poate reîmprospăta doar când chiar se schimbă ceva.

**Impact estimat: de departe cel mai mare. Efort: mic, o singură funcție.**

### 2. Ascultătorii fără limită cresc la nesfârșit

Două ascultătoare live pornesc la deschiderea panoului și nu au nicio limită:

- **`downloads`** — tot istoricul de descărcări, ordonat. Nu se șterge niciodată
  nimic, deci crește la infinit. Peste un an de utilizare devine considerabil.
- **`submissions`** — toate albumele trimise, din toate clasele, cu tot cu
  referințele către poze.

Panoul nu are nevoie de tot acest volum la pornire. Logurile se consultă rar și
pe o singură clasă, iar albumele detaliate se văd doar când deschizi o clasă.

**Soluție:** `limit()` pe loguri (ex. ultimele 200) și încărcarea albumelor doar
pentru clasa deschisă. Pentru numărul de albume trimise afișat în listă, se poate
salva un contor pe documentul clasei.

**Impact: mare și crește în timp. Efort: mic pentru loguri, mediu pentru albume.**

### 3. Documentele de clasă conțin lista de poze în interior

Fiecare document de clasă are câmpul `galleryPhotos` cu toate pozele galeriei
clasei incluse direct în el (o clasă din platformă are 248). Când panoul
încarcă lista de clase, descarcă **și toate aceste liste de poze**, deși lista
afișează doar numele școlii, dirigintele, progresul și termenul.

Firestore nu permite citirea parțială a unui document — ori îl iei tot, ori
deloc. Singura soluție reală este mutarea pozelor într-o subcolecție, exact cum
este deja făcut la galeriile foto.

**Impact: mare. Efort: mai mare — necesită migrarea datelor existente.**
Recomand să fie ultimul pas, după ce se văd rezultatele de la 1 și 2.

### 4. Lipsesc antetele de cache

`firebase.json` **nu conține deloc o secțiune `hosting`**, deci fișierele se
servesc cu setările implicite. Fișierele generate de build au deja nume unice cu
hash, deci pot fi păstrate în cache un an fără niciun risc.

Separat, pozele încărcate în Storage **nu primesc niciun antet de cache**, deci
implicit se re-descarcă după o oră. Miniaturile din panou se descarcă practic
din nou la fiecare sesiune de lucru.

**Impact: mediu, dar se simte la fiecare reîncărcare. Efort: foarte mic.**

---

## Plan de acțiune

### Etapa 0 — doar consolă și configurare (fără cod, risc zero)

1. **Adaugă antete de cache în `firebase.json`.** Fișierele cu hash în nume →
   `max-age=31536000, immutable`. `index.html` → fără cache, ca să se ia mereu
   versiunea nouă. Nu se șterge nimic, doar se adaugă o secțiune.
2. **Setează cache pe fișierele din Storage.** Pentru cele existente se poate
   rula o singură comandă `gsutil setmeta` peste bucket. Pentru cele noi,
   metadata se adaugă la upload (mică modificare de cod, la etapa 1).
3. **Verifică regiunea bazei de date.** Dacă baza `xiacollection` este într-o
   regiune din SUA, fiecare cerere din România pierde ~100–150 ms doar pe drum.
   Nu se poate schimba regiunea unei baze existente, dar merită știut — dacă
   diferența e mare, se poate crea o bază în `europe-central2` sau
   `europe-west1` și migra ulterior. **Nu recomand asta acum**, doar de verificat.

### Etapa 1 — cea mai mare îmbunătățire, cu cel mai mic risc

4. **Înlocuiește numărarea pozelor** cu `getCountFromServer()`, sau folosește
   direct `photoCount` deja salvat. Se elimină peste 1000 de citiri și toate
   scrierile de fundal, la fiecare încărcare.
5. **Adaugă `limit()` pe logurile de descărcare.**
6. **Adaugă `cacheControl` la upload**, ca pozele noi să fie păstrate în cache.

Aceste trei modificări sunt izolate, nu schimbă nimic din ce vede utilizatorul
și nu ating structura datelor.

### Etapa 2 — după ce se confirmă câștigul de la etapa 1

7. **Încarcă albumele trimise doar pentru clasa deschisă**, nu pe toate odată.
   Pentru numărul afișat în listă, se salvează un contor pe clasă.

### Etapa 3 — doar dacă mai este nevoie

8. **Mutarea `galleryPhotos` din documentul clasei într-o subcolecție.** Este
   modificarea corectă din punct de vedere tehnic, dar implică migrarea datelor
   existente și trebuie făcută cu atenție, cu backup înainte.

---

## Ce NU va ajuta

- **Ștergerea pozelor sau curățarea storage-ului.** Mărimea totală a
  storage-ului nu influențează viteza panoului. Panoul nu citește fișierele,
  citește doar documentele care le descriu.
- **Un plan Firebase mai scump.** Problema nu este limita de resurse, ci
  numărul de citiri.
- **Împărțirea suplimentară a bundle-ului JavaScript.** Chunk-ul panoului are
  deja doar 39 kB comprimat; nu el ține pagina în loc.

---

## Un beneficiu secundar: costul

Firestore se taxează per document citit. Numărarea actuală generează peste 1000
de citiri la fiecare deschidere a panoului, plus scrieri. Reparând punctul 1,
scad simultan și timpul de încărcare, și factura — cu atât mai mult cu cât
biblioteca de fotografii crește.

---

## Cum verificăm rezultatul

1. În Chrome DevTools → Network, se măsoară timpul până la afișarea listei de
   clase, înainte și după fiecare etapă.
2. În consola Firebase → Firestore → Usage, se compară numărul de citiri pe zi.
   Ar trebui să scadă vizibil după etapa 1.
3. Se verifică din nou după adăugarea unei galerii noi mari — testul real este
   ca timpul de încărcare să **nu** crească proporțional cu numărul de poze.

---

## Recomandarea mea

Etapa 0 și punctul 4 din etapa 1 rezolvă, foarte probabil, cea mai mare parte a
problemei, cu modificări mici și izolate. Aș începe strict cu acestea, aș măsura,
și abia apoi aș decide dacă mai este nevoie de etapele următoare.
