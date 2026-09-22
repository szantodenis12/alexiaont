/**
 * File naming inside selection archives.
 *
 * Files used to be prefixed with the order the client picked them in
 * ("001_XIA03247.jpg"), so photos from different folders ended up interleaved
 * in pick order. The original file name now comes FIRST, so sorting by name in
 * Explorer/Finder gives the photographer's own sequence back.
 */

const splitExt = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
};

/** "XIA03247.jpg" + "personal_bw" -> "XIA03247_personal_bw.jpg" */
export function nameFirst(original: string | undefined, tag: string, fallback: string): string {
  if (!original) return `${fallback}.jpg`;
  if (!tag) return original;
  const [base, ext] = splitExt(original);
  return `${base}_${tag}${ext || '.jpg'}`;
}

/**
 * Returns a function that makes names unique within one archive folder.
 *
 * The old order prefix guaranteed uniqueness for free. Without it, two photos
 * with the same file name from different gallery folders would collide, and
 * JSZip silently keeps only the last one — so a repeat gets "_2", "_3"...
 */
export function createUniqueNamer(): (name: string) => string {
  const used = new Set<string>();
  return (name: string) => {
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const [base, ext] = splitExt(name);
    let n = 2;
    while (used.has(`${base}_${n}${ext}`.toLowerCase())) n++;
    const unique = `${base}_${n}${ext}`;
    used.add(unique.toLowerCase());
    return unique;
  };
}
