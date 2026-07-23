// Profanity Filter for Romanian, Hungarian, and English
// Standard lists of common offensive words normalized to lowercase without diacritics

const englishBadWords = [
  'fuck', 'shit', 'asshole', 'bitch', 'cunt', 'dick', 'pussy', 'cock', 'bastard', 'slut', 'whore',
  'motherfucker', 'dumbass', 'wanker', 'prick', 'bollocks', 'crap', 'twat'
];

const romanianBadWords = [
  'pula', 'pizda', 'coaie', 'cahat', 'drac', 'muie', 'sugi', 'cur', 'fut', 'futu', 'futut', 
  'jeg', 'jegos', 'retard', 'tampit', 'proast', 'prost', 'bozg', 'handicap', 'idiot', 'tarf',
  'tarfa', 'curva', 'curve', 'mue', 'suge'
];

const hungarianBadWords = [
  'szar', 'geci', 'picsa', 'fasz', 'kurva', 'basz', 'baszni', 'segg', 'seggfej', 'buzi', 
  'ribanc', 'kocsog', 'hulye', 'balfasz', 'faszfej', 'kurvaneve', 'szopj', 'szopni'
];

// Combine all words into a single Set for O(1) lookups
const allBadWords = new Set([
  ...englishBadWords,
  ...romanianBadWords,
  ...hungarianBadWords
]);

/**
 * Normalizes text by converting to lowercase, removing Romanian/Hungarian diacritics,
 * and replacing common character substitutions (e.g., '3' for 'e', '@' for 'a').
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/ș/g, 's')
    .replace(/ț/g, 't')
    .replace(/ă/g, 'a')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/ő/g, 'o')
    .replace(/ű/g, 'u')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
}

/**
 * Checks if a string contains any profanities in RO, HU, or EN.
 * Performs word boundary check.
 */
export function containsProfanity(text: string): boolean {
  if (!text) return false;
  
  const normalized = normalizeText(text);
  
  // Split text by non-alphabetic characters to get individual words
  const words = normalized.split(/[^a-z]+/);
  
  for (const word of words) {
    if (word.length > 2 && allBadWords.has(word)) {
      return true;
    }
  }

  // Also check if any bad word is embedded as a substring (in case of spaces bypassed)
  // for words that are long enough to avoid false positives (length > 3)
  for (const badWord of allBadWords) {
    if (badWord.length > 3 && normalized.includes(badWord)) {
      return true;
    }
  }

  return false;
}
