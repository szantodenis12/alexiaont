/**
 * Helpers shared by the voice-message recorder, the submit flow and the admin
 * ZIP export: container/extension mapping and friendly Romanian error texts.
 */

/** Preferred recorder formats, best first. iOS Safari only knows audio/mp4. */
export const VOICE_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

/** First MediaRecorder-supported mime type, or '' to let the browser choose. */
export function pickVoiceMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  for (const t of VOICE_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* ignore and try the next one */
    }
  }
  return '';
}

/** Plain container type without the ";codecs=..." suffix. */
export function baseMimeType(mime: string | undefined | null): string {
  return (mime || '').split(';')[0].trim().toLowerCase();
}

/** File extension (with dot) for a recorded audio mime type. */
export function voiceExtensionForMime(mime: string | undefined | null): string {
  const m = baseMimeType(mime);
  if (m === 'audio/mp4' || m === 'audio/x-m4a' || m === 'audio/m4a' || m === 'audio/aac') return '.m4a';
  if (m === 'audio/ogg') return '.ogg';
  return '.webm';
}

/** Extension of a stored voice file path (falls back to .webm for old data). */
export function voiceExtensionFromPath(path: string | undefined | null): string {
  const m = /\.(webm|m4a|mp4|aac|ogg|oga)$/i.exec(path || '');
  return m ? '.' + m[1].toLowerCase() : '.webm';
}

/** Whether we are inside an in-app browser (Instagram, Facebook, TikTok...) that usually blocks the microphone. */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|musical_ly|TikTok|Snapchat|Messenger|MicroMessenger|; wv\)/i.test(navigator.userAgent || '');
}

/** Friendly Romanian message for a getUserMedia / MediaRecorder failure. */
export function describeMicError(err: unknown): string {
  const name = (err as any)?.name || '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Accesul la microfon este blocat. Apasă pe iconița de lacăt/setări din bara de adrese (sau Setări > Browser > Microfon), alege „Permite" pentru microfon, apoi reîncarcă pagina și încearcă din nou.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Nu am găsit niciun microfon pe acest dispozitiv. Conectează un microfon sau încearcă de pe alt telefon/calculator.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Microfonul este folosit de altă aplicație (apel, alt browser sau altă filă). Închide-le și încearcă din nou.';
    case 'NotSupportedError':
      return 'Browserul tău nu poate înregistra audio. Deschide linkul în Chrome sau Safari și încearcă din nou.';
    default:
      return 'Nu am putut porni înregistrarea. Reîncarcă pagina sau deschide linkul în Chrome/Safari și încearcă din nou. Poți trimite selecția și fără mesaj vocal.';
  }
}

/** Friendly Romanian message when the voice upload fails (Firebase code or network). */
export function describeVoiceUploadError(err: unknown): string {
  const code = String((err as any)?.code || '');
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return 'Clasa este închisă sau termenul limită a trecut, deci mesajul vocal nu a putut fi încărcat.';
  }
  if (code === 'storage/canceled' || code === 'storage/retry-limit-exceeded' || code === 'storage/unknown' || code === 'storage/server-file-wrong-size'
    || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return 'Conexiunea la internet a fost întreruptă în timpul încărcării mesajului vocal.';
  }
  if (code === 'storage/quota-exceeded') return 'Spațiul de stocare este momentan plin.';
  return 'Mesajul vocal nu a putut fi încărcat.';
}
