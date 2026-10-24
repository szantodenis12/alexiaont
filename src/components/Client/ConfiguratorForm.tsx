import React, { useState } from 'react';
import { db, storage } from '../../firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { containsProfanity } from '../../utils/profanityFilter';
import { convertToGrayscale } from '../../utils/imageProcessor';
import { PhotoPickerModal } from './PhotoPickerModal';
import { getClassSessions } from '../../utils/classPhotos';
import type { ClassSession } from '../../utils/classPhotos';
import { VoiceRecorder } from '../Common/VoiceRecorder';
import { getPhotoDisplayName } from '../../utils/photoName';
import type { CustomField } from '../../utils/excelExporter';
import { 
  ArrowLeft, Image as ImageIcon, RefreshCw, 
  Sparkles, BookOpen, CheckCircle2, X, Lock, Mic
} from 'lucide-react';

interface Photo {
  name: string;
  url: string;
  path: string;
}

interface ClassData {
  id: string;
  schoolName: string;
  diriginteName: string;
  studentList: string[];
  status: 'active' | 'locked';
  requireEmailDownload: boolean;
  extraPagesPrice: number;
  extraPagesEnabled?: boolean;
  /** Photos allowed on one extra page (admin-set). Missing min = 1, missing max = unlimited. */
  extraPagePhotosMin?: number;
  extraPagePhotosMax?: number;
  albumTypesEnabled?: boolean;
  priceAlbumMare?: number;
  priceAlbumMic?: number;
  minPhotos?: number;
  maxPhotos?: number;
  minPhotosAlbumMare?: number;
  maxPhotosAlbumMare?: number;
  minPhotosAlbumMic?: number;
  maxPhotosAlbumMic?: number;
  enableObservatii?: boolean;
  enablePoster?: boolean;
  enableSonete?: boolean;
  enableSonetPhoto?: boolean;
  enableSonetCitat?: boolean;
  priceSonet?: number;
  enableExtraItems?: boolean;
  customFields?: CustomField[];
  galleryPhotos: Photo[];
  deadline?: any;
  enableVoiceMessage?: boolean;
  sessions?: ClassSession[];
}

interface PhotoSelection {
  url: string;
  bw: boolean;
  name?: string;
}

interface ConfiguratorFormProps {
  classData: ClassData;
  studentName: string;
  albumName: string;
  existingSubmission: any | null;
  onBack: () => void;
  // Set when the class diriginte (not a student) is filling the form: studentName
  // is then the reserved key from utils/diriginte and displayName is shown instead.
  displayName?: string;
  isDiriginte?: boolean;
}

export const ConfiguratorForm: React.FC<ConfiguratorFormProps> = ({
  classData,
  studentName,
  albumName,
  existingSubmission,
  onBack,
  displayName,
  isDiriginte = false
}) => {
  // What the person sees as "their name" (the reserved diriginte key is never shown).
  const shownName = displayName || studentName;
  // 1 & 2. Name on album
  // Never falls back to the roster name: that is numbered ("1. ALEXIA ONT") and
  // ends up printed on the album and shown on the voice-message page.
  const [customAlbumName, setCustomAlbumName] = useState(
    existingSubmission?.albumName || albumName || ''
  );

  // 3 & 4 & 5. Photos
  const [copertaPhoto, setCopertaPhoto] = useState<PhotoSelection | null>(
    existingSubmission?.copertaPhoto ? { url: existingSubmission.copertaPhoto.url, bw: existingSubmission.copertaPhoto.bw } : null
  );
  const [colegiPhoto, setColegiPhoto] = useState<PhotoSelection | null>(
    existingSubmission?.colegiPhoto ? { url: existingSubmission.colegiPhoto.url, bw: existingSubmission.colegiPhoto.bw } : null
  );
  const [personalPhotos, setPersonalPhotos] = useState<PhotoSelection[]>(
    existingSubmission?.personalPhotos 
      ? existingSubmission.personalPhotos.map((p: any) => ({ url: p.url, bw: p.bw })) 
      : []
  );
  const [citat, setCitat] = useState(existingSubmission?.citat || '');

  // 7. Observatii (Toggle)
  const [hasObservatiiToggle, setHasObservatiiToggle] = useState<boolean>(
    existingSubmission?.hasObservatiiToggle ?? (!!existingSubmission?.observatii)
  );
  const [observatii, setObservatii] = useState(existingSubmission?.observatii || '');

  // 8. Album Size (Mare / Mic)
  // Starts unselected so the student makes a deliberate choice — pre-selecting
  // "mare" meant an unnoticed default could be submitted (and charged) by accident.
  const [selectedAlbumType, setSelectedAlbumType] = useState<'mare' | 'mic' | null>(
    existingSubmission?.selectedAlbumType || null
  );

  // 9. Poster (Toggle & Photo)
  const [wantsPoster, setWantsPoster] = useState<boolean>(
    existingSubmission?.wantsPoster ?? (!!existingSubmission?.posterPhoto)
  );
  const [posterPhoto, setPosterPhoto] = useState<PhotoSelection | null>(
    existingSubmission?.posterPhoto ? { url: existingSubmission.posterPhoto.url, bw: existingSubmission.posterPhoto.bw } : null
  );

  // 10. Sonet (Photo & Citat Toggles)
  const [wantsSonetPhoto, setWantsSonetPhoto] = useState<boolean>(
    existingSubmission?.wantsSonetPhoto ?? (!!existingSubmission?.sonetPhoto)
  );
  const [sonetPhoto, setSonetPhoto] = useState<PhotoSelection | null>(
    existingSubmission?.sonetPhoto ? { url: existingSubmission.sonetPhoto.url, bw: existingSubmission.sonetPhoto.bw } : null
  );
  const [wantsSonetCitat, setWantsSonetCitat] = useState<boolean>(
    existingSubmission?.wantsSonetCitat ?? (!!existingSubmission?.citatSonet)
  );
  const [citatSonet, setCitatSonet] = useState(existingSubmission?.citatSonet || '');

  // 11. Extra Items (Canvas, printuri etc.)
  const [wantsExtraItems, setWantsExtraItems] = useState<boolean>(
    existingSubmission?.wantsExtraItems ?? (!!existingSubmission?.extraItemsText)
  );
  const [extraItemsText, setExtraItemsText] = useState(existingSubmission?.extraItemsText || '');

  // Admin-defined custom fields (per class). Seeded with each field's saved
  // answer when reopening an existing submission, defaulting to '' / false
  // otherwise so controlled inputs never start out undefined.
  const [customAnswers, setCustomAnswers] = useState<Record<string, string | boolean>>(() => {
    const initial: Record<string, string | boolean> = {};
    (classData.customFields || []).forEach((field) => {
      const existingValue = existingSubmission?.customAnswers?.[field.id];
      initial[field.id] = existingValue !== undefined
        ? existingValue
        : (field.type === 'checkbox' ? false : '');
    });
    return initial;
  });

  const [hasSonet] = useState<boolean>(
    existingSubmission?.hasSonet || false
  );

  // Extra album pages bought by the student (price per page = classData.extraPagesPrice).
  // Each page has its own photo selection, saved as `extraPages: [{ photos }]`;
  // the page count is also saved as extraPersonalPagesCount, the field the class
  // sheet / Excel export already read.
  const MAX_EXTRA_PAGES = 10;
  // 0 when the class has extra pages disabled (classData.extraPagesEnabled === false).
  const extraPageUnitPrice = classData.extraPagesEnabled === false ? 0 : (classData.extraPagesPrice == null ? 10 : (Number(classData.extraPagesPrice) || 0));
  const [extraPages, setExtraPages] = useState<PhotoSelection[][]>(() => {
    const saved = existingSubmission?.extraPages;
    if (Array.isArray(saved)) {
      return saved.slice(0, MAX_EXTRA_PAGES).map((pg: any) =>
        Array.isArray(pg?.photos) ? pg.photos.map((p: any) => ({ url: p.url, bw: !!p.bw })) : []
      );
    }
    // Older submissions only stored how many extra pages were bought: keep that
    // many (empty) pages so the purchase is not lost; the student fills in photos.
    const n = Number(existingSubmission?.extraPersonalPagesCount);
    const count = Number.isFinite(n) ? Math.min(MAX_EXTRA_PAGES, Math.max(0, Math.floor(n))) : 0;
    return Array.from({ length: count }, () => [] as PhotoSelection[]);
  });
  // Pages that actually count: none when the class has no (paid) extra pages.
  const activeExtraPages: PhotoSelection[][] = extraPageUnitPrice > 0 ? extraPages : [];
  const extraPagesCount = activeExtraPages.length;
  // Photos allowed per extra page (admin: extraPagePhotosMin / extraPagePhotosMax).
  // Missing min = 1, missing (or invalid) max = unlimited.
  const rawExtraMin = Number(classData.extraPagePhotosMin);
  const extraPageMin = classData.extraPagePhotosMin != null && Number.isFinite(rawExtraMin)
    ? Math.max(1, Math.floor(rawExtraMin)) : 1;
  const rawExtraMax = Number(classData.extraPagePhotosMax);
  const extraPageMax: number | undefined =
    classData.extraPagePhotosMax != null && Number.isFinite(rawExtraMax) && Math.floor(rawExtraMax) >= extraPageMin
      ? Math.floor(rawExtraMax) : undefined;
  const extraPageRuleText = extraPageMax !== undefined
    ? (extraPageMax === extraPageMin ? `Alege ${extraPageMin} ${extraPageMin === 1 ? 'poză' : 'poze'}` : `Alege între ${extraPageMin} și ${extraPageMax} poze`)
    : `Alege cel puțin ${extraPageMin} ${extraPageMin === 1 ? 'poză' : 'poze'}`;
  const isExtraPageComplete = (photos: PhotoSelection[]) =>
    photos.length >= extraPageMin && (extraPageMax === undefined || photos.length <= extraPageMax);
  const changeExtraPagesCount = (next: number) => {
    const target = Math.min(MAX_EXTRA_PAGES, Math.max(0, Math.floor(next)));
    if (target < extraPages.length) {
      // Dropping pages that already have photos needs one confirmation (names the last such page).
      for (let i = extraPages.length - 1; i >= target; i--) {
        if (extraPages[i].length > 0) {
          if (!window.confirm(`Pagina extra ${i + 1} are poze selectate. Sigur o ștergi?`)) return;
          break;
        }
      }
    }
    setExtraPages((prev) => {
      if (target <= prev.length) return prev.slice(0, target);
      return [...prev, ...Array.from({ length: target - prev.length }, () => [] as PhotoSelection[])];
    });
  };

  const [voiceAudioBlob, setVoiceAudioBlob] = useState<Blob | null>(null);
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>(existingSubmission?.voiceWaveform || []);

  // Modals state
  // A selection stores only the full-size url, so map it back to the gallery
  // photo's ~1200px preview for display. Falls back to the original when a photo
  // predates previews. Downloads and the saved submission keep the full-size url.
  // `classData.galleryPhotos` is the list the picker shows: ConfiguratorEntry fills
  // it with loadClassPhotos (the `photos` subcollection, or the legacy array).
  // A selection normally stores `photo.url`, but index it under every url variant
  // so older submissions (clean / preview / thumb url) still resolve.
  const photoByUrl = React.useMemo(() => {
    const m = new Map<string, any>();
    (classData.galleryPhotos || []).forEach((p: any) => {
      if (!p) return;
      [p.url, p.cleanUrl, p.previewUrl, p.previewCleanUrl, p.thumbUrl].forEach((u: string | undefined) => {
        if (u && !m.has(u)) m.set(u, p);
      });
    });
    return m;
  }, [classData.galleryPhotos]);
  const thumb = (sel?: { url?: string } | null) =>
    sel?.url ? (photoByUrl.get(sel.url)?.previewUrl || sel.url) : undefined;

  // File name of a selected photo (shown under its thumbnail so students can
  // reference it in notes). Selections only keep the url, so look the gallery
  // photo up for its original name, falling back to the name inside the url.
  const photoName = (sel?: { url?: string } | null): string =>
    sel?.url ? getPhotoDisplayName({ name: photoByUrl.get(sel.url)?.name, url: sel.url }) : '';

  const [pickerConfig, setPickerConfig] = useState<{
    isOpen: boolean;
    field: 'coperta' | 'colegi' | 'personal' | 'extrapage' | 'poster' | 'sonet';
    multiple: boolean;
    minRequired: number;
    maxAllowed?: number;
    /** Which extra page is being edited (field === 'extrapage'). */
    pageIndex?: number;
    title?: string;
  } | null>(null);

  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  
  const isPreviewGrayscale = () => {
    if (!previewPhotoUrl) return false;
    if (copertaPhoto?.url === previewPhotoUrl) return copertaPhoto.bw;
    if (colegiPhoto?.url === previewPhotoUrl) return colegiPhoto.bw;
    if (posterPhoto?.url === previewPhotoUrl) return posterPhoto.bw;
    if (sonetPhoto?.url === previewPhotoUrl) return sonetPhoto.bw;
    const personalFound = personalPhotos.find(p => p.url === previewPhotoUrl);
    if (personalFound) return personalFound.bw;
    for (const page of activeExtraPages) {
      const found = page.find(p => p.url === previewPhotoUrl);
      if (found) return found.bw;
    }
    return false;
  };
  
  // Submit state
  const [showReview, setShowReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStepText, setSubmitStepText] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  // Profanity error
  const hasCitatProfanity = citat.trim().length > 0 && containsProfanity(citat);

  // Validate form requirements (Unified min & max photos set by admin)
  const minRequiredPersonal = classData.minPhotos ?? classData.minPhotosAlbumMare ?? classData.minPhotosAlbumMic ?? 4;
  const maxAllowedPersonal = classData.maxPhotos ?? classData.maxPhotosAlbumMare ?? classData.maxPhotosAlbumMic ?? 20;

  // A required custom field blocks submission until answered: text/textarea
  // need a non-empty value, a required "Da/Nu" needs to be checked.
  const requiredCustomFieldsFilled = () =>
    (classData.customFields || []).every((field) => {
      if (!field.required) return true;
      const value = customAnswers[field.id];
      return field.type === 'checkbox' ? value === true : !!(value && String(value).trim().length > 0);
    });

  const isFormValid = () => {
    // Album size is only required when the class actually offers the choice.
    const albumTypeChosen =
      classData.albumTypesEnabled === false || selectedAlbumType !== null;

    return (
      albumTypeChosen &&
      customAlbumName.trim().length > 0 &&
      copertaPhoto !== null &&
      colegiPhoto !== null &&
      personalPhotos.length >= minRequiredPersonal &&
      personalPhotos.length <= maxAllowedPersonal &&
      !hasCitatProfanity &&
      requiredCustomFieldsFilled() &&
      activeExtraPages.every(isExtraPageComplete)
    );
  };

  const openPicker = (
    field: 'coperta' | 'colegi' | 'personal' | 'extrapage' | 'poster' | 'sonet',
    multiple = false,
    minRequired = 1,
    maxAllowed?: number,
    pageIndex?: number
  ) => {
    setPickerConfig({
      isOpen: true,
      field,
      multiple,
      minRequired,
      maxAllowed,
      pageIndex,
      title: field === 'extrapage' && pageIndex !== undefined ? `Pagina extra ${pageIndex + 1}` : undefined
    });
  };

  const handlePickerConfirm = (urls: string[], pickerBwStates?: Record<string, boolean>) => {
    if (!pickerConfig) return;

    const isBw = (url: string, existingBw: boolean) => {
      if (pickerBwStates && pickerBwStates[url] !== undefined) {
        return pickerBwStates[url];
      }
      return existingBw;
    };

    if (pickerConfig.field === 'coperta') {
      setCopertaPhoto(urls.length > 0 ? { url: urls[0], bw: isBw(urls[0], copertaPhoto?.url === urls[0] ? copertaPhoto.bw : false) } : null);
    } else if (pickerConfig.field === 'colegi') {
      setColegiPhoto(urls.length > 0 ? { url: urls[0], bw: isBw(urls[0], colegiPhoto?.url === urls[0] ? colegiPhoto.bw : false) } : null);
    } else if (pickerConfig.field === 'poster') {
      setPosterPhoto(urls.length > 0 ? { url: urls[0], bw: isBw(urls[0], posterPhoto?.url === urls[0] ? posterPhoto.bw : false) } : null);
    } else if (pickerConfig.field === 'sonet') {
      setSonetPhoto(urls.length > 0 ? { url: urls[0], bw: isBw(urls[0], sonetPhoto?.url === urls[0] ? sonetPhoto.bw : false) } : null);
    } else if (pickerConfig.field === 'personal') {
      // Map URLs to selection objects, keeping B/W states if they were already selected
      const updated = urls.map(url => {
        const existing = personalPhotos.find(p => p.url === url);
        return { url, bw: isBw(url, existing ? existing.bw : false) };
      });
      setPersonalPhotos(updated);
    } else if (pickerConfig.field === 'extrapage' && typeof pickerConfig.pageIndex === 'number') {
      const pageIndex = pickerConfig.pageIndex;
      setExtraPages(prev => prev.map((page, i) => {
        if (i !== pageIndex) return page;
        return urls.map(url => {
          const existing = page.find(p => p.url === url);
          return { url, bw: isBw(url, existing ? existing.bw : false) };
        });
      }));
    }
  };

  const toggleBw = (field: 'coperta' | 'colegi' | 'personal' | 'poster' | 'sonet', index?: number) => {
    if (field === 'coperta' && copertaPhoto) {
      setCopertaPhoto({ ...copertaPhoto, bw: !copertaPhoto.bw });
    } else if (field === 'colegi' && colegiPhoto) {
      setColegiPhoto({ ...colegiPhoto, bw: !colegiPhoto.bw });
    } else if (field === 'poster' && posterPhoto) {
      setPosterPhoto({ ...posterPhoto, bw: !posterPhoto.bw });
    } else if (field === 'sonet' && sonetPhoto) {
      setSonetPhoto({ ...sonetPhoto, bw: !sonetPhoto.bw });
    } else if (field === 'personal' && typeof index === 'number') {
      const updated = [...personalPhotos];
      updated[index] = { ...updated[index], bw: !updated[index].bw };
      setPersonalPhotos(updated);
    }
  };

  const toggleExtraPageBw = (pageIndex: number, photoIndex: number) => {
    setExtraPages(prev => prev.map((page, i) =>
      i !== pageIndex ? page : page.map((p, j) => (j === photoIndex ? { ...p, bw: !p.bw } : p))
    ));
  };

  // Backend image B/W processing helper
  const processAndUploadIfBw = async (
    selection: PhotoSelection,
    fileNamePrefix: string
  ): Promise<string> => {
    if (!selection.bw) {
      return selection.url; // Save original URL directly to optimize storage
    }

    try {
      // Convert to B/W client-side
      const bwBlob = await convertToGrayscale(selection.url);
      const storageRef = ref(
        storage,
        `submissions/${classData.id}/${studentName}/${fileNamePrefix}_${Date.now()}_bw.jpg`
      );
      
      // Upload B/W blob to Storage
      await uploadBytes(storageRef, bwBlob);
      const downloadUrl = await getDownloadURL(storageRef);
      return downloadUrl;
    } catch (err) {
      console.warn('B/W client-side processing failed, falling back to original URL:', err);
      // Fallback: use original url. The photographer will know it should be B/W because `bw: true` is saved in Firestore.
      return selection.url;
    }
  };

  const handleFinalSubmit = async () => {
    if (!isFormValid()) return;

    setIsSubmitting(true);
    setShowReview(false);

    try {
      // 1. Process Coperta Photo
      setSubmitStepText('Se procesează poza pentru copertă...');
      const copertaProcessedUrl = await processAndUploadIfBw(copertaPhoto!, 'coperta');

      // 2. Process Colegi Photo
      setSubmitStepText('Se procesează poza pentru colegi...');
      const colegiProcessedUrl = await processAndUploadIfBw(colegiPhoto!, 'colegi');

      // 3. Process Personal Photos
      setSubmitStepText('Se procesează pozele personale...');
      const personalProcessed: any[] = [];
      for (let i = 0; i < personalPhotos.length; i++) {
        setSubmitStepText(`Se procesează poza personală ${i + 1}/${personalPhotos.length}...`);
        const processedUrl = await processAndUploadIfBw(personalPhotos[i], `personal_${i}`);
        personalProcessed.push({
          url: personalPhotos[i].url,
          processedUrl,
          bw: personalPhotos[i].bw
        });
      }

      // 4. Process Poster Photo if enabled & requested
      let posterProcessedUrl = null;
      if (wantsPoster && posterPhoto) {
        setSubmitStepText('Se procesează poza pentru poster...');
        posterProcessedUrl = await processAndUploadIfBw(posterPhoto, 'poster');
      }

      // 5. Process Sonet Photo if enabled & requested
      let sonetProcessedUrl = null;
      if (wantsSonetPhoto && sonetPhoto) {
        setSubmitStepText('Se procesează poza pentru sonet...');
        sonetProcessedUrl = await processAndUploadIfBw(sonetPhoto, 'sonet');
      }

      // 6. Process the photos of every extra page (none when extra pages are off for the class)
      const extraPagesProcessed: string[][] = [];
      for (let pg = 0; pg < activeExtraPages.length; pg++) {
        const pagePhotos = activeExtraPages[pg];
        const processedUrls: string[] = [];
        for (let i = 0; i < pagePhotos.length; i++) {
          setSubmitStepText(`Se procesează pagina extra ${pg + 1}/${activeExtraPages.length}, poza ${i + 1}/${pagePhotos.length}...`);
          processedUrls.push(await processAndUploadIfBw(pagePhotos[i], `extrapage${pg + 1}_${i}`));
        }
        extraPagesProcessed.push(processedUrls);
      }

      // Helper to find photo name
      const getPhotoNameFromUrl = (url: string): string => {
        return photoByUrl.get(url)?.name || getPhotoDisplayName(url) || 'photo.jpg';
      };

      const submissionId = `${classData.id}_${studentName}`;

      // 7. Upload Voice Message Audio if recorded
      let voiceMessageUrl = existingSubmission?.voiceMessageUrl || null;
      let voiceMessagePath = existingSubmission?.voiceMessagePath || null;

      if (voiceAudioBlob) {
        setSubmitStepText('Se urcă mesajul vocal...');
        const safeStudentName = studentName.replace(/[^a-z0-9]/gi, '_');
        const audioPath = `submissions/${classData.id}/${safeStudentName}/voice_${Date.now()}.webm`;
        const audioStorageRef = ref(storage, audioPath);
        await uploadBytes(audioStorageRef, voiceAudioBlob);
        voiceMessageUrl = await getDownloadURL(audioStorageRef);
        voiceMessagePath = audioPath;
      }

      // Calculate total cost
      const baseAlbumPrice = classData.albumTypesEnabled !== false
        ? (selectedAlbumType === 'mare' ? (classData.priceAlbumMare ?? 150) : (classData.priceAlbumMic ?? 100))
        : 0;
      const sonetPrice = classData.enableSonete !== false && (hasSonet || wantsSonetPhoto || wantsSonetCitat) ? (classData.priceSonet ?? 25) : 0;
      const totalCost = baseAlbumPrice + sonetPrice + extraPagesCost;

      // 8. Save submission to Firestore
      setSubmitStepText('Se salvează configurarea în baza de date...');
      await setDoc(doc(db, 'submissions', submissionId), {
        classId: classData.id,
        studentName,
        albumName: customAlbumName.trim(),
        selectedAlbumType,
        hasSonet: hasSonet || wantsSonetPhoto || wantsSonetCitat,
        totalCost,
        hasObservatiiToggle,
        observatii: hasObservatiiToggle ? observatii : '',
        wantsPoster,
        posterPhoto: (wantsPoster && posterPhoto) ? {
          url: posterPhoto.url,
          processedUrl: posterProcessedUrl,
          bw: posterPhoto.bw,
          name: getPhotoNameFromUrl(posterPhoto.url)
        } : null,
        wantsSonetPhoto,
        sonetPhoto: (wantsSonetPhoto && sonetPhoto) ? {
          url: sonetPhoto.url,
          processedUrl: sonetProcessedUrl,
          bw: sonetPhoto.bw,
          name: getPhotoNameFromUrl(sonetPhoto.url)
        } : null,
        wantsSonetCitat,
        citatSonet: wantsSonetCitat ? citatSonet : '',
        wantsExtraItems,
        extraItemsText: wantsExtraItems ? extraItemsText : '',
        copertaPhoto: {
          url: copertaPhoto!.url,
          processedUrl: copertaProcessedUrl,
          bw: copertaPhoto!.bw,
          name: getPhotoNameFromUrl(copertaPhoto!.url)
        },
        colegiPhoto: {
          url: colegiPhoto!.url,
          processedUrl: colegiProcessedUrl,
          bw: colegiPhoto!.bw,
          name: getPhotoNameFromUrl(colegiPhoto!.url)
        },
        personalPhotos: personalPhotos.map((p, idx) => ({
          url: p.url,
          processedUrl: personalProcessed[idx].processedUrl,
          bw: p.bw,
          name: getPhotoNameFromUrl(p.url)
        })),
        citat: citat.trim(),
        // Extra pages: one { photos } per page, photo entries shaped like personalPhotos.
        // extraPersonalPagesCount stays in sync with it for the sheet / Excel totals.
        extraPages: activeExtraPages.map((pagePhotos, pg) => ({
          photos: pagePhotos.map((p, idx) => ({
            url: p.url,
            processedUrl: extraPagesProcessed[pg][idx],
            bw: p.bw,
            name: getPhotoNameFromUrl(p.url)
          }))
        })),
        extraPersonalPagesCount: activeExtraPages.length,
        ...(voiceMessageUrl ? { voiceMessageUrl, voiceMessagePath } : {}),
        ...(voiceWaveform.length > 0 ? { voiceWaveform } : {}),
        // Custom answers keyed by field id, plus a label snapshot (taken now,
        // at submission time) so the admin still sees meaningful labels even
        // if the class's custom fields are later renamed or deleted.
        ...((classData.customFields && classData.customFields.length > 0) ? {
          customAnswers,
          customAnswerLabels: classData.customFields.reduce((acc, field) => {
            acc[field.id] = field.label;
            return acc;
          }, {} as Record<string, string>)
        } : {}),
        ...(isDiriginte ? { isDiriginte: true } : {}),
        submittedAt: new Date()
      }, { merge: true });

      setSubmitStepText('Finalizat cu succes!');
      setShowSuccess(true);

    } catch (err: any) {
      console.error('Submission failed:', err);
      alert(`Trimiterea a eșuat: ${err?.message || err}. Te rugăm să încerci din nou sau să contactezi fotograful.`);
    } finally {
      setIsSubmitting(false);
    }
  };



  const getSelectedPhotos = (field: 'coperta' | 'colegi' | 'personal' | 'extrapage' | 'poster' | 'sonet', pageIndex?: number) => {
    if (field === 'coperta') return copertaPhoto ? [copertaPhoto] : [];
    if (field === 'colegi') return colegiPhoto ? [colegiPhoto] : [];
    if (field === 'poster') return posterPhoto ? [posterPhoto] : [];
    if (field === 'sonet') return sonetPhoto ? [sonetPhoto] : [];
    if (field === 'personal') return personalPhotos;
    return (typeof pageIndex === 'number' && extraPages[pageIndex]) || [];
  };

  // Cost breakdown shown in the review screen (same maths as before, split into lines).
  const baseAlbumPrice = classData.albumTypesEnabled !== false
    ? (selectedAlbumType === 'mare' ? (classData.priceAlbumMare ?? 150) : (classData.priceAlbumMic ?? 100))
    : 0;
  const sonetPrice = classData.enableSonete !== false && (hasSonet || wantsSonetPhoto || wantsSonetCitat) ? (classData.priceSonet ?? 25) : 0;
  const extraPagesCost = extraPageUnitPrice > 0 ? extraPagesCount * extraPageUnitPrice : 0;
  const totalCost = baseAlbumPrice + sonetPrice + extraPagesCost;

  // Section numbers follow the visual order; sections that are switched off for
  // this class are skipped so there are never gaps.
  const secNum = (() => {
    let n = 0;
    const nums: Record<'names' | 'album' | 'photos' | 'citat' | 'obs' | 'custom' | 'poster' | 'sonet' | 'items' | 'extraPages' | 'voice', number> = {
      names: ++n,
      album: classData.albumTypesEnabled !== false ? ++n : 0,
      photos: ++n,
      citat: ++n,
      obs: classData.enableObservatii !== false ? ++n : 0,
      custom: (classData.customFields || []).length > 0 ? ++n : 0,
      poster: classData.enablePoster !== false ? ++n : 0,
      sonet: classData.enableSonete !== false ? ++n : 0,
      items: classData.enableExtraItems !== false ? ++n : 0,
      extraPages: extraPageUnitPrice > 0 ? ++n : 0,
      voice: classData.enableVoiceMessage ? ++n : 0,
    };
    return nums;
  })();

  const reviewTextNums = [citat.trim() ? secNum.citat : 0, hasObservatiiToggle && observatii.trim() ? secNum.obs : 0].filter(n => n > 0).join(' & ');

  return (
    <div className="configurator-wrapper">
      {/* Read-only Header */}
      <header className="config-header">
        <button onClick={onBack} className="back-btn-client">
          <ArrowLeft size={16} /> Înapoi
        </button>
        <div className="header-details">
          <h2>{classData.schoolName}</h2>
          <p className="teacher-name-label">{isDiriginte ? 'Diriginte' : 'Elev'}: <span className="student-highlight">{isDiriginte ? classData.diriginteName : shownName}</span>{!isDiriginte && <> | Diriginte: {classData.diriginteName}</>}</p>
        </div>
        <div className="logo-placeholder" style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/LOGO ALBUME.svg" alt="Alexia Graduation Albums Logo" style={{ height: '42px', width: 'auto' }} />
        </div>
      </header>

      {/* Main Configurator Form */}
      <main className="config-main container">
        {existingSubmission && (
          <div className="alert-prepopulated">
            <Sparkles size={16} className="sparkle-icon" />
            <span>Opțiunile tale anterioare au fost încărcate. Le poți edita și trimite din nou.</span>
          </div>
        )}

        {classData.deadline && (
          <div className="alert-deadline">
            <Lock size={16} style={{ color: '#C5A880', flexShrink: 0 }} />
            <span>Te rugăm să trimiți selecția ta până la data de: <strong>{classData.deadline.toDate ? classData.deadline.toDate().toLocaleDateString('ro-RO') : new Date(classData.deadline).toLocaleDateString('ro-RO')}</strong>. După această dată, configuratorul se va bloca automat.</span>
          </div>
        )}

        <div className="steps-layout">
          {/* PASUL 1 & 2: Identificare & Nume pe Album */}
          <div className="config-section">
            <div className="section-title-wrapper">
              <Sparkles size={20} className="section-icon" />
              <h3>{secNum.names}. Numele Tău & Numele pe Album</h3>
            </div>
            <div className="form-group name-grid">
              <div>
                <label className="form-label" style={{ color: '#A3A09B' }}>{isDiriginte ? 'Diriginte' : 'Nume Elev (Selectat din listă)'}</label>
                <input type="text" readOnly value={shownName} className="form-input" style={{ backgroundColor: '#161514', color: '#FAF9F6', border: '1px solid #2D2A28', borderRadius: '6px' }} />
              </div>
              <div>
                <label className="form-label" style={{ color: '#A3A09B' }}>Nume Dorit pe Album (Printat)</label>
                <input 
                  type="text" 
                  value={customAlbumName} 
                  onChange={(e) => setCustomAlbumName(e.target.value)} 
                  placeholder={shownName}
                  className="form-input" 
                  style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', borderRadius: '6px' }} 
                />
              </div>
            </div>
          </div>

          {/* PASUL 8: Alegere Pachet Album (MARE x lei / MIC y lei) */}
          {classData.albumTypesEnabled !== false && (
            <div className="config-section">
              <div className="section-title-wrapper">
                <Sparkles size={20} className="section-icon" style={{ color: '#C5A880' }} />
                <h3>{secNum.album}. Alege Pachetul de Album</h3>
              </div>
              <div className="album-type-grid" role="radiogroup" aria-label="Pachet album">
                <div
                  role="radio"
                  aria-checked={selectedAlbumType === 'mare'}
                  tabIndex={0}
                  onClick={() => setSelectedAlbumType('mare')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAlbumType('mare'); } }}
                  className={`album-type-card ${selectedAlbumType === 'mare' ? 'selected' : ''}`}
                >
                  <div className="album-type-top">
                    <strong className="album-type-name">{selectedAlbumType === 'mare' && <CheckCircle2 size={15} style={{ color: '#D4AF37', flexShrink: 0 }} />}ALBUM MARE</strong>
                    <strong className="album-type-price">{classData.priceAlbumMare ?? 150} LEI</strong>
                  </div>
                  <p className="album-type-desc">Pachet album format mare.</p>
                </div>

                <div
                  role="radio"
                  aria-checked={selectedAlbumType === 'mic'}
                  tabIndex={0}
                  onClick={() => setSelectedAlbumType('mic')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAlbumType('mic'); } }}
                  className={`album-type-card ${selectedAlbumType === 'mic' ? 'selected' : ''}`}
                >
                  <div className="album-type-top">
                    <strong className="album-type-name">{selectedAlbumType === 'mic' && <CheckCircle2 size={15} style={{ color: '#D4AF37', flexShrink: 0 }} />}ALBUM MIC</strong>
                    <strong className="album-type-price">{classData.priceAlbumMic ?? 100} LEI</strong>
                  </div>
                  <p className="album-type-desc">Pachet album format mic.</p>
                </div>
              </div>
            </div>
          )}

          {/* Section 1: Required Photos */}
          <div className="config-section">
            <div className="section-title-wrapper">
              <BookOpen size={20} className="section-icon" />
              <h3>{secNum.photos}. Fotografii Obligatorii</h3>
            </div>

            <div className="photo-picker-row">
              {/* Coperta Picker */}
              <div className="picker-container-item">
                <span className="picker-label">Poză Copertă (Coperta albumului)</span>
                {copertaPhoto ? (
                  <div className="selected-card">
                    <div 
                      className={`thumbnail-preview ${copertaPhoto.bw ? 'grayscale' : ''}`}
                      onClick={() => setPreviewPhotoUrl(copertaPhoto.url)}
                      title="Click pentru a mări"
                    >
                      <img src={thumb(copertaPhoto)} alt="Coperta" />
                    </div>
                    <div className="selected-controls">
                      <span className="photo-name" title={photoName(copertaPhoto)}>{photoName(copertaPhoto)}</span>
                      <label className="bw-toggle-container">
                        <input
                          type="checkbox"
                          checked={copertaPhoto.bw}
                          onChange={() => toggleBw('coperta')}
                        />
                        <span className="bw-checkbox-custom"></span>
                        <span className="bw-label-text">Alb-Negru (B/W)</span>
                      </label>
                      <button onClick={() => openPicker('coperta')} className="btn-change">
                        Schimbă poza
                      </button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => openPicker('coperta')} className="empty-picker-placeholder">
                    <ImageIcon size={32} />
                    <span>Selectează Poză Copertă</span>
                  </div>
                )}
              </div>

              {/* Colegi Picker */}
              <div className="picker-container-item">
                <span className="picker-label">Poză Colegi (Pentru albumele colegilor)</span>
                {colegiPhoto ? (
                  <div className="selected-card">
                    <div 
                      className={`thumbnail-preview ${colegiPhoto.bw ? 'grayscale' : ''}`}
                      onClick={() => setPreviewPhotoUrl(colegiPhoto.url)}
                      title="Click pentru a mări"
                    >
                      <img src={thumb(colegiPhoto)} alt="Colegi" />
                    </div>
                    <div className="selected-controls">
                      <span className="photo-name" title={photoName(colegiPhoto)}>{photoName(colegiPhoto)}</span>
                      <label className="bw-toggle-container">
                        <input
                          type="checkbox"
                          checked={colegiPhoto.bw}
                          onChange={() => toggleBw('colegi')}
                        />
                        <span className="bw-checkbox-custom"></span>
                        <span className="bw-label-text">Alb-Negru (B/W)</span>
                      </label>
                      <button onClick={() => openPicker('colegi')} className="btn-change">
                        Schimbă poza
                      </button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => openPicker('colegi')} className="empty-picker-placeholder">
                    <ImageIcon size={32} />
                    <span>Selectează Poză Colegi</span>
                  </div>
                )}
              </div>
            </div>

            {/* Personal Photos Picker (Multi-select) */}
            <div className="multi-picker-container">
              <div className="multi-picker-header">
                <div className="multi-picker-text">
                  <span className="picker-label">Fotografii Personale (Minim {minRequiredPersonal} poze, maxim {maxAllowedPersonal})</span>
                  <p className="guideline-text">~10 fotografii recomandate pentru o așezare optimă în pagină.</p>
                </div>
                <button 
                  onClick={() => openPicker('personal', true, minRequiredPersonal, maxAllowedPersonal)} 
                  className="btn btn-secondary btn-sm"
                >
                  {personalPhotos.length > 0 ? 'Gestionează Poze' : 'Alege Poze'}
                </button>
              </div>

              {personalPhotos.length > 0 ? (
                <div className="thumbnails-grid">
                  {personalPhotos.map((photo, index) => (
                    <div key={photo.url} className="thumbnail-card-grid">
                      <div 
                        className={`grid-thumbnail ${photo.bw ? 'grayscale' : ''}`}
                        onClick={() => setPreviewPhotoUrl(photo.url)}
                        title="Click pentru a mări"
                      >
                        <img src={thumb(photo)} alt={`Personal ${index + 1}`} />
                      </div>
                      <div className="photo-name" title={photoName(photo)}>{photoName(photo)}</div>
                      <div className="grid-controls">
                        <label className="bw-toggle-container-grid">
                          <input 
                            type="checkbox" 
                            checked={photo.bw}
                            onChange={() => toggleBw('personal', index)}
                          />
                          <span className="bw-checkbox-custom"></span>
                          <span className="bw-label-text">B/W</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div onClick={() => openPicker('personal', true, minRequiredPersonal, maxAllowedPersonal)} className="empty-picker-placeholder multi">
                  <ImageIcon size={36} />
                  <span>Selectează Fotografii Personale (Minim {minRequiredPersonal})</span>
                </div>
              )}
            </div>
          </div>

          {/* PASUL 6: Citat Album */}
          <div className="config-section">
            <div className="section-title-wrapper">
              <Sparkles size={20} className="section-icon" />
              <h3>{secNum.citat}. Citat Album</h3>
            </div>
            <div className="form-group">
              <textarea
                rows={3}
                placeholder="Scrie citatul tău preferat pentru album..."
                value={citat}
                onChange={(e) => setCitat(e.target.value)}
                className={`form-textarea-client ${hasCitatProfanity ? 'error' : ''}`}
                maxLength={350}
              />
              <div className="textarea-footer">
                {hasCitatProfanity && (
                  <span className="error-message-text">
                    Citatul tău conține cuvinte nepotrivite. Te rugăm să le elimini pentru a putea trimite.
                  </span>
                )}
                <span className="char-count">{citat.length}/350</span>
              </div>
            </div>
          </div>

          {/* PASUL 7: Observații pentru Designer (Toggle ON/OFF) */}
          {classData.enableObservatii !== false && (
            <div className="config-section">
              <div className="section-head-toggle">
                <div className="section-title-wrapper" style={{ margin: 0 }}>
                  <Sparkles size={20} className="section-icon" />
                  <h3>{secNum.obs}. Ai observații de spus pentru designer?</h3>
                </div>
                <label className="toggle-switch-wrapper" style={{ margin: 0 }}>
                  <input 
                    type="checkbox" 
                    checked={hasObservatiiToggle}
                    onChange={(e) => setHasObservatiiToggle(e.target.checked)}
                  />
                  <span className="slider round"></span>
                </label>
              </div>

              {hasObservatiiToggle && (
                <textarea
                  rows={3}
                  placeholder="Scrie observațiile tale pentru designer (ex: poziționare pagină, retuș etc.)"
                  value={observatii}
                  onChange={(e) => setObservatii(e.target.value)}
                  className="form-textarea-client"
                  maxLength={500}
                />
              )}
            </div>
          )}

          {/* Câmpuri personalizate definite de fotograf pentru această clasă */}
          {(classData.customFields || []).length > 0 && (
            <div className="config-section">
              <div className="section-title-wrapper">
                <Sparkles size={20} className="section-icon" />
                <h3>{secNum.custom}. Întrebări suplimentare</h3>
              </div>
              <div className="custom-fields-list">
                {(classData.customFields || []).map((field) => (
                  <div key={field.id} className="form-group">
                    {field.type === 'checkbox' ? (
                      <label className="custom-checkbox-row">
                        <input
                          type="checkbox"
                          checked={!!customAnswers[field.id]}
                          onChange={(e) => setCustomAnswers(prev => ({ ...prev, [field.id]: e.target.checked }))}
                        />
                        <span>{field.label}{field.required && <span style={{ color: 'var(--gold-accent)' }}> *</span>}</span>
                      </label>
                    ) : (
                      <>
                        <label className="form-label" style={{ color: '#A3A09B' }}>
                          {field.label}{field.required && <span style={{ color: 'var(--gold-accent)' }}> *</span>}
                        </label>
                        {field.type === 'textarea' ? (
                          <textarea
                            rows={3}
                            value={(customAnswers[field.id] as string) || ''}
                            onChange={(e) => setCustomAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                            className="form-textarea-client"
                            maxLength={500}
                          />
                        ) : (
                          <input
                            type="text"
                            value={(customAnswers[field.id] as string) || ''}
                            onChange={(e) => setCustomAnswers(prev => ({ ...prev, [field.id]: e.target.value }))}
                            className="form-input"
                            style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', borderRadius: '6px' }}
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PASUL 8: Poză pentru Poster (Toggle ON/OFF) */}
          {classData.enablePoster !== false && (
            <div className="config-section">
              <div className="section-head-toggle">
                <div className="section-title-wrapper" style={{ margin: 0 }}>
                  <ImageIcon size={20} className="section-icon" />
                  <h3>{secNum.poster}. Poză pentru Poster</h3>
                </div>
                <label className="toggle-switch-wrapper" style={{ margin: 0 }}>
                  <input 
                    type="checkbox" 
                    checked={wantsPoster}
                    onChange={(e) => setWantsPoster(e.target.checked)}
                  />
                  <span className="slider round"></span>
                </label>
              </div>

              {wantsPoster && (
                <div style={{ marginTop: '12px' }}>
                  {posterPhoto ? (
                    <div className="selected-card selected-card-compact">
                      <div className={`thumbnail-preview ${posterPhoto.bw ? 'grayscale' : ''}`} onClick={() => setPreviewPhotoUrl(posterPhoto.url)}>
                        <img src={thumb(posterPhoto)} alt="Poster" />
                      </div>
                      <div className="selected-controls">
                        <span className="photo-name" title={photoName(posterPhoto)}>{photoName(posterPhoto)}</span>
                        <label className="bw-toggle-container">
                          <input type="checkbox" checked={posterPhoto.bw} onChange={() => toggleBw('poster')} />
                          <span className="bw-checkbox-custom"></span>
                          <span className="bw-label-text">B/W</span>
                        </label>
                        <button onClick={() => openPicker('poster')} className="btn-change">Schimbă</button>
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => openPicker('poster')} className="empty-picker-placeholder">
                      <ImageIcon size={32} />
                      <span>Selectează Poză pentru Poster</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* PASUL 9 & 10: Sonet Școlar - Poză (ON/OFF) & Citat (ON/OFF) */}
          {classData.enableSonete !== false && (
            <div className="config-section">
              <div className="section-title-wrapper">
                <BookOpen size={20} className="section-icon" style={{ color: '#C5A880' }} />
                <h3>{secNum.sonet}. Sonet Școlar (+{classData.priceSonet ?? 25} LEI)</h3>
              </div>

              {/* 9. Poză pt Sonet */}
              {classData.enableSonetPhoto !== false && (
                <div className="sonet-block">
                  <div className="toggle-row">
                    <span className="toggle-row-text">Adaugă Poză pentru Sonet?</span>
                    <label className="toggle-switch-wrapper" style={{ margin: 0 }}>
                      <input type="checkbox" checked={wantsSonetPhoto} onChange={(e) => setWantsSonetPhoto(e.target.checked)} />
                      <span className="slider round"></span>
                    </label>
                  </div>

                  {wantsSonetPhoto && (
                    <div style={{ marginTop: '8px' }}>
                      {sonetPhoto ? (
                        <div className="selected-card selected-card-compact">
                          <div className={`thumbnail-preview ${sonetPhoto.bw ? 'grayscale' : ''}`} onClick={() => setPreviewPhotoUrl(sonetPhoto.url)}>
                            <img src={thumb(sonetPhoto)} alt="Sonet" />
                          </div>
                          <div className="selected-controls">
                            <span className="photo-name" title={photoName(sonetPhoto)}>{photoName(sonetPhoto)}</span>
                            <label className="bw-toggle-container">
                              <input type="checkbox" checked={sonetPhoto.bw} onChange={() => toggleBw('sonet')} />
                              <span className="bw-checkbox-custom"></span>
                              <span className="bw-label-text">B/W</span>
                            </label>
                            <button onClick={() => openPicker('sonet')} className="btn-change">Schimbă</button>
                          </div>
                        </div>
                      ) : (
                        <div onClick={() => openPicker('sonet')} className="empty-picker-placeholder">
                          <ImageIcon size={32} />
                          <span>Selectează Poză pentru Sonet</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 10. Citat pt Sonet */}
              {classData.enableSonetCitat !== false && (
                <div>
                  <div className="toggle-row">
                    <span className="toggle-row-text">Adaugă Citat special pentru Sonet?</span>
                    <label className="toggle-switch-wrapper" style={{ margin: 0 }}>
                      <input type="checkbox" checked={wantsSonetCitat} onChange={(e) => setWantsSonetCitat(e.target.checked)} />
                      <span className="slider round"></span>
                    </label>
                  </div>

                  {wantsSonetCitat && (
                    <textarea
                      rows={2}
                      placeholder="Scrie citatul tău special pentru sonet..."
                      value={citatSonet}
                      onChange={(e) => setCitatSonet(e.target.value)}
                      className="form-textarea-client"
                      maxLength={250}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* PASUL 11: Cumpărături Extra (Canvas, Poze printate etc.) */}
          {classData.enableExtraItems !== false && (
            <div className="config-section">
              <div className="section-head-toggle">
                <div className="section-title-wrapper" style={{ margin: 0 }}>
                  <Sparkles size={20} className="section-icon" />
                  <h3>{secNum.items}. Dorești să cumperi lucruri extra în plus? (canvas, poze scoase etc.)</h3>
                </div>
                <label className="toggle-switch-wrapper" style={{ margin: 0 }}>
                  <input type="checkbox" checked={wantsExtraItems} onChange={(e) => setWantsExtraItems(e.target.checked)} />
                  <span className="slider round"></span>
                </label>
              </div>

              {wantsExtraItems && (
                <textarea
                  rows={3}
                  placeholder="Scrie aici ce dorești să cumperi în plus (ex: 2x tablou canvas 30x40cm, 5x poze scoase 10x15...)"
                  value={extraItemsText}
                  onChange={(e) => setExtraItemsText(e.target.value)}
                  className="form-textarea-client"
                />
              )}
            </div>
          )}

          {/* Pagini extra în album (doar dacă fotograful a setat un preț > 0) */}
          {extraPageUnitPrice > 0 && (
            <div className="config-section">
              <div className="section-title-wrapper">
                <Sparkles size={20} className="section-icon" />
                <h3>{secNum.extraPages}. Pagini extra în album (+{extraPageUnitPrice} LEI / pagină)</h3>
              </div>
              <p className="section-help">
                Alege câte pagini suplimentare dorești în album (maxim {MAX_EXTRA_PAGES}), apoi alege pozele pentru fiecare pagină.
              </p>
              <div className="stepper-row">
                <button
                  type="button"
                  className="btn-secondary stepper-btn"
                  aria-label="Scade numărul de pagini extra"
                  disabled={extraPagesCount <= 0}
                  onClick={() => changeExtraPagesCount(extraPagesCount - 1)}
                >−</button>
                <input
                  type="number"
                  min={0}
                  max={MAX_EXTRA_PAGES}
                  value={extraPagesCount}
                  aria-label="Număr de pagini extra"
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    changeExtraPagesCount(Number.isFinite(n) ? n : 0);
                  }}
                  className="form-input stepper-input"
                  style={{ backgroundColor: '#161514', color: '#FAF9F6', border: '1px solid #2D2A28', borderRadius: '6px' }}
                />
                <button
                  type="button"
                  className="btn-secondary stepper-btn"
                  aria-label="Crește numărul de pagini extra"
                  disabled={extraPagesCount >= MAX_EXTRA_PAGES}
                  onClick={() => changeExtraPagesCount(extraPagesCount + 1)}
                >+</button>
                <span className="stepper-total">
                  {extraPagesCount > 0 ? `= ${extraPagesCost} LEI` : ''}
                </span>
              </div>

              {activeExtraPages.length > 0 && (
                <div className="extra-pages-list">
                  {activeExtraPages.map((pagePhotos, pageIdx) => {
                    const complete = isExtraPageComplete(pagePhotos);
                    return (
                      <div key={pageIdx} className={`extra-page-card ${complete ? 'complete' : ''}`}>
                        <div className="extra-page-head">
                          <div className="extra-page-text">
                            <span className="picker-label">Pagina extra {pageIdx + 1}</span>
                            <p className="guideline-text">
                              {extraPageRuleText}
                              {pagePhotos.length > 0 && ` · ${pagePhotos.length} ${pagePhotos.length === 1 ? 'selectată' : 'selectate'}`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => openPicker('extrapage', true, extraPageMin, extraPageMax, pageIdx)}
                            className="btn btn-secondary btn-sm"
                          >
                            {pagePhotos.length > 0 ? 'Modifică pozele' : 'Alege poze'}
                          </button>
                        </div>

                        {pagePhotos.length > 0 && (
                          <div className="thumbnails-grid">
                            {pagePhotos.map((photo, index) => (
                              <div key={photo.url} className="thumbnail-card-grid">
                                <div
                                  className={`grid-thumbnail ${photo.bw ? 'grayscale' : ''}`}
                                  onClick={() => setPreviewPhotoUrl(photo.url)}
                                  title="Click pentru a mări"
                                >
                                  <img src={thumb(photo)} alt={`Pagina extra ${pageIdx + 1}, poza ${index + 1}`} />
                                </div>
                                <div className="photo-name" title={photoName(photo)}>{photoName(photo)}</div>
                                <div className="grid-controls">
                                  <label className="bw-toggle-container-grid">
                                    <input
                                      type="checkbox"
                                      checked={photo.bw}
                                      onChange={() => toggleExtraPageBw(pageIdx, index)}
                                    />
                                    <span className="bw-checkbox-custom"></span>
                                    <span className="bw-label-text">B/W</span>
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section 4: Voice Message (if enabled for class) */}
          {classData.enableVoiceMessage && (
            <div className="config-section">
              <div className="section-title-wrapper">
                <Mic size={20} className="section-icon" style={{ color: '#C5A880' }} />
                <h3>{secNum.voice}. Mesaj Vocal Album (Opțional, max. 1 min)</h3>
              </div>
              <p className="section-help">
                Înregistrează un mesaj vocal pentru albumul tău. La scanarea codului QR tipărit pe album, oricine va putea asculta mesajul tău!
              </p>
              <VoiceRecorder onAudioRecorded={(blob, peaks) => {
                setVoiceAudioBlob(blob);
                if (peaks && peaks.length > 0) setVoiceWaveform(peaks);
              }} />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="configurator-footer-bar">
          <div className="requirements-summary">
            {!copertaPhoto && <span className="req-item missing">• Poză Copertă</span>}
            {copertaPhoto && <span className="req-item met">✓ Poză Copertă</span>}
            {!colegiPhoto && <span className="req-item missing">• Poză Colegi</span>}
            {colegiPhoto && <span className="req-item met">✓ Poză Colegi</span>}
            {classData.albumTypesEnabled !== false && (
              selectedAlbumType === null
                ? <span className="req-item missing">• Pachet Album</span>
                : <span className="req-item met">✓ Pachet Album</span>
            )}
            {personalPhotos.length < minRequiredPersonal ? (
              <span className="req-item missing">• Poze Personale ({personalPhotos.length}/{minRequiredPersonal})</span>
            ) : personalPhotos.length > maxAllowedPersonal ? (
              <span className="req-item missing">• Poze Personale ({personalPhotos.length}, maxim {maxAllowedPersonal})</span>
            ) : (
              <span className="req-item met">✓ Poze Personale ({personalPhotos.length})</span>
            )}
            {activeExtraPages.map((pagePhotos, pageIdx) => {
              const done = isExtraPageComplete(pagePhotos);
              const tooMany = extraPageMax !== undefined && pagePhotos.length > extraPageMax;
              const label = `Pagina extra ${pageIdx + 1} (${pagePhotos.length}${!done && !tooMany ? `/${extraPageMin}` : ''}${tooMany ? `, maxim ${extraPageMax}` : ''})`;
              return done
                ? <span key={`xp${pageIdx}`} className="req-item met">✓ {label}</span>
                : <span key={`xp${pageIdx}`} className="req-item missing">• {label}</span>;
            })}
          </div>
          <button 
            disabled={!isFormValid()} 
            onClick={() => setShowReview(true)}
            className="btn btn-primary btn-submit-album"
          >
            Revizuiește Album
          </button>
        </div>
      </main>

      {/* 1. Photo Picker Modal */}
      {pickerConfig?.isOpen && (
        <PhotoPickerModal
          isOpen={pickerConfig.isOpen}
          onClose={() => setPickerConfig(null)}
          photos={classData.galleryPhotos}
          selectedPhotos={getSelectedPhotos(pickerConfig.field, pickerConfig.pageIndex)}
          onConfirm={handlePickerConfirm}
          multiple={pickerConfig.multiple}
          minRequired={pickerConfig.minRequired}
          maxAllowed={pickerConfig.maxAllowed}
          title={pickerConfig.title}
          fieldKey={`${classData.id}_${pickerConfig.field}${pickerConfig.pageIndex !== undefined ? pickerConfig.pageIndex : ''}`}
          sessions={getClassSessions(classData)}
        />
      )}

      {/* 2. Full Image Preview Overlay */}
      {previewPhotoUrl && (
        <div className="image-preview-overlay" onClick={() => setPreviewPhotoUrl(null)}>
          <div className="preview-container">
            <button className="preview-close-btn" onClick={() => setPreviewPhotoUrl(null)}>
              <X size={24} />
            </button>
            <img 
              src={previewPhotoUrl} 
              alt="Preview" 
              className={`preview-large-image ${isPreviewGrayscale() ? 'grayscale' : ''}`}
            />
            {photoName({ url: previewPhotoUrl }) && (
              <div className="preview-caption">{photoName({ url: previewPhotoUrl })}</div>
            )}
          </div>
        </div>
      )}

      {/* 3. Review Dialog */}
      {showReview && (
        <div className="picker-modal-overlay review-overlay">
          <div className="review-modal-content">
            <div className="picker-modal-header">
              <h3>Revizuire Date Album</h3>
              <button onClick={() => setShowReview(false)} className="picker-close-btn">
                <X size={20} />
              </button>
            </div>
            <div className="review-scroll-body">
              <p className="review-intro">Verifică cu atenție toate opțiunile și fotografiile selectate înainte de a trimite.</p>
              
              {/* Summary Header Banner */}
              <div className="review-section-item review-summary">
                <div className="review-summary-grid">
                  <div>
                    <span className="review-label-photo">{isDiriginte ? 'Diriginte:' : 'Nume Elev:'}</span>
                    <h4 className="review-summary-value">{shownName}</h4>
                  </div>
                  <div>
                    <span className="review-label-photo">Nume Dorit pe Album:</span>
                    <h4 className="review-summary-value gold">{customAlbumName.trim() || shownName}</h4>
                  </div>
                  {classData.albumTypesEnabled !== false && (
                    <div>
                      <span className="review-label-photo">Pachet Album:</span>
                      <h4 className="review-summary-value">
                        {selectedAlbumType === 'mic' ? 'Album Mic' : 'Album Mare'}
                      </h4>
                    </div>
                  )}
                  <div>
                    <span className="review-label-photo">Cost Total Estimat:</span>
                    <h4 className="review-summary-value gold total">{totalCost} LEI</h4>
                  </div>
                </div>
              </div>

              {/* Cover & Classmates photos */}
              <div className="review-section-item">
                <h4>{secNum.photos}. Fotografii Obligatorii</h4>
                <div className="review-photos-row">
                  <div className="review-photo-item">
                    <span className="review-label-photo">Copertă</span>
                    <img src={thumb(copertaPhoto)} alt="Coperta" className={copertaPhoto?.bw ? 'grayscale' : ''} />
                    {copertaPhoto?.bw && <span className="bw-badge-review">B/W</span>}
                    <span className="photo-name" title={photoName(copertaPhoto)}>{photoName(copertaPhoto)}</span>
                  </div>
                  <div className="review-photo-item">
                    <span className="review-label-photo">Colegi</span>
                    <img src={thumb(colegiPhoto)} alt="Colegi" className={colegiPhoto?.bw ? 'grayscale' : ''} />
                    {colegiPhoto?.bw && <span className="bw-badge-review">B/W</span>}
                    <span className="photo-name" title={photoName(colegiPhoto)}>{photoName(colegiPhoto)}</span>
                  </div>
                </div>
              </div>

              {/* Personal photos */}
              <div className="review-section-item">
                <h4>Fotografii Personale ({personalPhotos.length} poze)</h4>
                <div className="review-grid-small">
                  {personalPhotos.map((p, idx) => (
                    <div key={idx} className="review-grid-cell">
                      <div className="review-photo-item-grid">
                        <img src={thumb(p)} alt={`Personal ${idx}`} className={p.bw ? 'grayscale' : ''} />
                        {p.bw && <span className="bw-badge-review-small">B/W</span>}
                      </div>
                      <span className="photo-name" title={photoName(p)}>{photoName(p)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Poster Photo if selected */}
              {wantsPoster && posterPhoto && (
                <div className="review-section-item">
                  <h4>{secNum.poster}. Poză pentru Poster</h4>
                  <div className="review-photos-row">
                    <div className="review-photo-item">
                      <img src={thumb(posterPhoto)} alt="Poster" className={posterPhoto.bw ? 'grayscale' : ''} />
                      {posterPhoto.bw && <span className="bw-badge-review">B/W</span>}
                      <span className="photo-name" title={photoName(posterPhoto)}>{photoName(posterPhoto)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sonete Școlare if selected */}
              {classData.enableSonete !== false && (wantsSonetPhoto || wantsSonetCitat || hasSonet) && (
                <div className="review-section-item">
                  <h4>{secNum.sonet}. Sonet Școlar</h4>
                  {wantsSonetPhoto && sonetPhoto && (
                    <div className="review-photos-row review-photos-row-spaced">
                      <div className="review-photo-item">
                        <span className="review-label-photo">Poză Sonet</span>
                        <img src={thumb(sonetPhoto)} alt="Sonet" className={sonetPhoto.bw ? 'grayscale' : ''} />
                        {sonetPhoto.bw && <span className="bw-badge-review">B/W</span>}
                        <span className="photo-name" title={photoName(sonetPhoto)}>{photoName(sonetPhoto)}</span>
                      </div>
                    </div>
                  )}
                  {wantsSonetCitat && citatSonet.trim() && (
                    <div className="review-text-block">
                      <span className="review-label-photo">Citat Sonet:</span>
                      <p className="review-quote-text">„{citatSonet}”</p>
                    </div>
                  )}
                </div>
              )}

              {/* Quote & Designer notes */}
              {(citat.trim() || (hasObservatiiToggle && observatii.trim())) && (
                <div className="review-section-item">
                  <h4>{reviewTextNums}. Text & Observații</h4>
                  {citat.trim() && (
                    <div className="review-text-block">
                      <span className="review-label-photo">Citat Album:</span>
                      <p className="review-quote-text">„{citat}”</p>
                    </div>
                  )}
                  {hasObservatiiToggle && observatii.trim() && (
                    <div className="review-text-block review-text-block-gap">
                      <span className="review-label-photo">Observații pentru designer:</span>
                      <p className="review-notes-text">{observatii}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Custom fields defined by the photographer for this class */}
              {(classData.customFields || []).length > 0 && (
                <div className="review-section-item">
                  <h4>{secNum.custom}. Întrebări suplimentare</h4>
                  {(classData.customFields || []).map((field) => {
                    const value = customAnswers[field.id];
                    if (value === '' || value === undefined) return null;
                    return (
                      <div key={field.id} className="review-text-block review-text-block-gap">
                        <span className="review-label-photo">{field.label}:</span>
                        <p className="review-notes-text">{field.type === 'checkbox' ? (value ? 'Da' : 'Nu') : String(value)}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Extra Items if requested */}
              {wantsExtraItems && extraItemsText.trim() && (
                <div className="review-section-item">
                  <h4>{secNum.items}. Cumpărături Extra (Produse suplimentare)</h4>
                  <div className="review-text-block">
                    <p className="review-notes-text" style={{ fontStyle: 'normal' }}>{extraItemsText}</p>
                  </div>
                </div>
              )}

              {/* Extra pages: each page with its photos */}
              {activeExtraPages.length > 0 && (
                <div className="review-section-item">
                  <h4>{secNum.extraPages}. Pagini Extra ({activeExtraPages.length})</h4>
                  <p className="extra-price-review">Cost suplimentar: <strong>{extraPagesCost} LEI</strong></p>
                  {activeExtraPages.map((pagePhotos, pageIdx) => (
                    <div key={pageIdx} className="review-extra-page">
                      <span className="review-label-photo">Pagina extra {pageIdx + 1} ({pagePhotos.length} {pagePhotos.length === 1 ? 'poză' : 'poze'})</span>
                      <div className="review-grid-small">
                        {pagePhotos.map((p, idx) => (
                          <div key={idx} className="review-grid-cell">
                            <div className="review-photo-item-grid">
                              <img src={thumb(p)} alt={`Pagina extra ${pageIdx + 1}, poza ${idx + 1}`} className={p.bw ? 'grayscale' : ''} />
                              {p.bw && <span className="bw-badge-review-small">B/W</span>}
                            </div>
                            <span className="photo-name" title={photoName(p)}>{photoName(p)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Voice Message */}
              {voiceAudioBlob && (
                <div className="review-section-item">
                  <h4>{secNum.voice}. Mesaj Vocal Audio</h4>
                  <p className="review-voice-note">✓ Mesaj vocal înregistrat (va fi atașat pe codul QR al albumului)</p>
                </div>
              )}

              {/* Cost breakdown */}
              <div className="review-section-item review-cost">
                <h4>Cost estimat</h4>
                {classData.albumTypesEnabled !== false && (
                  <div className="cost-line">
                    <span>{selectedAlbumType === 'mic' ? 'Album Mic' : 'Album Mare'}</span>
                    <span>{baseAlbumPrice} LEI</span>
                  </div>
                )}
                {sonetPrice > 0 && (
                  <div className="cost-line"><span>Sonet școlar</span><span>{sonetPrice} LEI</span></div>
                )}
                {extraPagesCost > 0 && (
                  <div className="cost-line"><span>Pagini extra ({extraPagesCount} × {extraPageUnitPrice} LEI)</span><span>{extraPagesCost} LEI</span></div>
                )}
                <div className="cost-line total"><span>Total estimat</span><span>{totalCost} LEI</span></div>
              </div>
            </div>
            <div className="picker-modal-footer">
              <button onClick={() => setShowReview(false)} className="btn btn-secondary">
                Mergi Înapoi
              </button>
              <button onClick={handleFinalSubmit} className="btn btn-gold">
                Trimite Datele
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Processing overlay */}
      {isSubmitting && (
        <div className="submitting-overlay">
          <div className="submitting-card">
            <RefreshCw className="spinner submitting-spinner" size={40} />
            <h3>Se trimite configurarea...</h3>
            <p>{submitStepText}</p>
          </div>
        </div>
      )}

      {/* 5. Success Popup */}
      {showSuccess && (
        <div className="submitting-overlay">
          <div className="success-card">
            <CheckCircle2 size={64} className="success-icon" />
            <h3>Date trimise cu succes!</h3>
            <p>
              Opțiunile tale pentru album au fost înregistrate. Fotograful a fost notificat. 
              Poți închide această fereastră sau te poți întoarce la pagina de start.
            </p>
            <button onClick={() => window.location.reload()} className="btn btn-primary">
              Finalizează
            </button>
          </div>
        </div>
      )}

      <style>{`
        .configurator-wrapper {
          min-height: 100vh;
          min-height: 100dvh;
          background-color: var(--bg-color);
          color: var(--text-primary);
          font-family: var(--font-sans);
          display: flex;
          flex-direction: column;
        }

        .config-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-color);
          background-color: var(--card-bg);
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .back-btn-client {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: 1px solid #2D2A28;
          color: #FAF9F6;
          padding: 8px 16px;
          border-radius: var(--radius-sm);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: var(--transition-fast);
        }

        .back-btn-client:hover {
          background-color: #22201F;
          border-color: #FAF9F6;
        }

        .header-details {
          text-align: center;
        }

        .header-details h2 {
          font-size: 18px;
          font-weight: 600;
        }

        .teacher-name-label {
          font-size: 12px;
          color: #A3A09B;
        }

        .student-highlight {
          color: #D8D0C8;
          font-weight: 600;
        }

        .logo-placeholder {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-serif);
          font-size: 14px;
          font-weight: 500;
          color: #FAF9F6;
        }

        .config-main {
          flex: 1;
          padding-top: 32px;
          padding-bottom: 120px;
          max-width: 900px !important;
        }

        .alert-prepopulated {
          display: flex;
          align-items: center;
          gap: 10px;
          background-color: rgba(197, 168, 128, 0.08);
          border: 1px solid rgba(197, 168, 128, 0.2);
          color: #D4AF37;
          padding: 12px 16px;
          border-radius: var(--radius-sm);
          font-size: 13px;
          margin-bottom: 24px;
        }

        .sparkle-icon {
          flex-shrink: 0;
        }

        .steps-layout {
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .config-section {
          background-color: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          padding: 32px;
        }

        .section-title-wrapper {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 24px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 12px;
        }

        .section-icon {
          color: #C5A880;
        }

        .section-title-wrapper h3 {
          font-size: 18px;
          font-weight: 500;
          color: #FAF9F6;
        }

        /* Photo Picker styles */
        .photo-picker-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-bottom: 32px;
        }

        @media (max-width: 768px) {
          .config-header {
            display: grid;
            grid-template-areas: 
              "back logo"
              "details details";
            grid-template-columns: 1fr auto;
            gap: 16px 12px;
            padding: 16px;
            align-items: center;
          }

          .back-btn-client {
            grid-area: back;
            justify-self: start;
            padding: 6px 12px;
            font-size: 12px;
          }

          .logo-placeholder {
            grid-area: logo;
            justify-self: end;
          }

          .logo-placeholder img {
            height: 32px !important;
          }

          .header-details {
            grid-area: details;
            text-align: center;
          }

          .header-details h2 {
            font-size: 15px;
            line-height: 1.35;
          }

          .teacher-name-label {
            font-size: 11px;
            line-height: 1.4;
            margin-top: 4px;
          }
        }

        @media (max-width: 600px) {
          .photo-picker-row {
            grid-template-columns: 1fr;
          }
        }

        .picker-container-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .picker-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 600;
          color: #A3A09B;
        }

        .guideline-text {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .empty-picker-placeholder {
          height: 200px;
          border: 2px dashed #2D2A28;
          border-radius: var(--radius-sm);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: #A3A09B;
          cursor: pointer;
          transition: var(--transition-fast);
          background-color: #22201F;
        }

        .empty-picker-placeholder:hover {
          border-color: var(--gold-accent);
          color: #FAF9F6;
          background-color: #2D2A28;
        }

        .empty-picker-placeholder.multi {
          height: 150px;
        }

        /* Selected Card UI */
        .selected-card {
          border: 1px solid #262423;
          border-radius: var(--radius-sm);
          padding: 12px;
          display: flex;
          gap: 16px;
          background-color: #22201F;
          align-items: center;
        }

        .thumbnail-preview {
          width: 80px;
          height: 100px;
          overflow: hidden;
          border-radius: var(--radius-sm);
          cursor: pointer;
          box-shadow: var(--shadow-sm);
          transition: transform 0.2s ease;
          background-color: #22201F;
          flex-shrink: 0;
        }

        .thumbnail-preview:hover {
          transform: scale(1.03);
        }

        .thumbnail-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .thumbnail-preview.grayscale img {
          filter: grayscale(100%);
        }

        .selected-controls {
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex: 1;
        }

        .bw-toggle-container {
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          font-size: 13px;
          gap: 8px;
        }

        .bw-toggle-container input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }

        .bw-checkbox-custom {
          width: 18px;
          height: 18px;
          border: 1px solid #363433;
          border-radius: 4px;
          background-color: #22201F;
          position: relative;
        }

        .bw-toggle-container input:checked ~ .bw-checkbox-custom {
          background-color: var(--gold-accent);
          border-color: var(--gold-accent);
        }

        .bw-checkbox-custom::after {
          content: "";
          position: absolute;
          display: none;
          left: 5px;
          top: 2px;
          width: 5px;
          height: 9px;
          border: solid white;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }

        .bw-toggle-container input:checked ~ .bw-checkbox-custom::after {
          display: block;
        }

        .bw-label-text {
          font-weight: 500;
          color: #FAF9F6;
        }

        .btn-change {
          background: none;
          border: 1px solid #2D2A28;
          color: #FAF9F6;
          padding: 6px 12px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-radius: 4px;
          font-weight: 600;
          cursor: pointer;
          align-self: flex-start;
          transition: var(--transition-fast);
        }

        .btn-change:hover {
          background-color: #2D2A28;
          border-color: #FAF9F6;
        }

        /* Multi Picker thumbnails */
        .multi-picker-container {
          border-top: 1px solid #262423;
          padding-top: 24px;
        }

        .multi-picker-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }

        .thumbnails-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
          gap: 16px;
        }

        .thumbnail-card-grid {
          border: 1px solid #262423;
          border-radius: var(--radius-sm);
          padding: 8px;
          background-color: #22201F;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .grid-thumbnail {
          aspect-ratio: 3/4;
          overflow: hidden;
          border-radius: var(--radius-sm);
          cursor: pointer;
          background-color: #161514;
        }

        .grid-thumbnail img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .grid-thumbnail.grayscale img {
          filter: grayscale(100%);
        }

        .grid-controls {
          display: flex;
          justify-content: center;
        }

        .bw-toggle-container-grid {
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          font-size: 11px;
          gap: 6px;
        }

        .bw-toggle-container-grid input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }

        .bw-toggle-container-grid input:checked ~ .bw-checkbox-custom {
          background-color: var(--gold-accent);
          border-color: var(--gold-accent);
        }

        .bw-toggle-container-grid input:checked ~ .bw-checkbox-custom::after {
          display: block;
        }

        /* Form elements client */
        .form-textarea-client {
          width: 100%;
          padding: 12px 16px;
          background-color: #22201F;
          border: 1px solid #2D2A28;
          border-radius: var(--radius-sm);
          color: #FAF9F6;
          transition: var(--transition-fast);
          outline: none;
          resize: vertical;
          font-size: 14px;
        }

        .form-textarea-client:focus {
          border-color: var(--gold-accent);
          background-color: #2D2A28;
        }

        .form-textarea-client.error {
          border-color: var(--error-color);
          background-color: rgba(169, 68, 66, 0.03);
        }

        .textarea-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-top: 6px;
        }

        .error-message-text {
          font-size: 12px;
          color: var(--error-color);
          max-width: 80%;
        }

        .char-count {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
        }

        .char-count-right {
          display: block;
          text-align: right;
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 4px;
        }

        /* Extra Pages slider */
        .extra-pages-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .extra-pages-header-row .section-title-wrapper {
          margin-bottom: 0;
          border-bottom: none;
          padding-bottom: 0;
        }

        .toggle-switch-wrapper {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 26px;
        }

        .toggle-switch-wrapper input {
          opacity: 0;
          width: 0;
          height: 0;
          }

        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--border-color);
          transition: .4s;
        }

        .slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .4s;
        }

        input:checked + .slider {
          background-color: var(--gold-accent);
        }

        input:checked + .slider:before {
          transform: translateX(24px);
        }

        .slider.round {
          border-radius: 34px;
        }

        .slider.round:before {
          border-radius: 50%;
        }

        .extra-pages-content {
          margin-top: 24px;
          border-top: 1px solid #262423;
          padding-top: 24px;
        }

        .price-banner {
          background-color: #22201F;
          border: 1px solid #262423;
          border-radius: var(--radius-sm);
          padding: 12px 16px;
          font-size: 13px;
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }

        .animate-slide {
          animation: slideDown 0.3s ease-out;
        }

        /* Footer bar sticky */
        .configurator-footer-bar {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(22, 21, 20, 0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-top: 1px solid #262423;
          padding: 20px 40px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 99;
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
        }

        .requirements-summary {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .req-item {
          font-size: 12px;
          font-weight: 500;
        }

        .req-item.met {
          color: var(--success-color);
        }

        .req-item.missing {
          color: #A3A09B;
        }

        .btn-submit-album {
          min-width: 180px;
          height: 44px;
        }

        /* Large Image Preview Overlay */
        .image-preview-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100vh;
          height: 100dvh;
          background: rgba(14, 13, 12, 0.95);
          z-index: 1100;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: zoom-out;
        }

        .preview-container {
          position: relative;
          width: 100%;
          height: 100vh;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
        }

        .preview-close-btn {
          position: absolute;
          top: 16px;
          right: 16px;
          background: rgba(14, 13, 12, 0.6);
          border: none;
          color: #FFFFFF;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 100;
          transition: background-color 0.15s;
        }

        .preview-close-btn:hover {
          background-color: rgba(14, 13, 12, 0.9);
        }

        .preview-large-image {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border-radius: 4px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }

        /* Submitting Overlay */
        .submitting-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100vh;
          height: 100dvh;
          background: rgba(14, 13, 12, 0.8);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          z-index: 2000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .submitting-card, .success-card {
          background-color: var(--card-bg);
          border-radius: var(--radius-md);
          padding: 40px;
          max-width: 480px;
          width: 100%;
          text-align: center;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
          border: 1px solid var(--border-color);
        }

        .submitting-spinner {
          color: var(--gold-accent);
          margin-bottom: 20px;
          animation: spin 1s linear infinite;
        }

        .success-icon {
          color: var(--success-color);
          margin-bottom: 20px;
        }

        .success-card h3, .submitting-card h3 {
          font-family: var(--font-serif);
          font-size: 24px;
          margin-bottom: 12px;
        }

        .success-card p, .submitting-card p {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.6;
          margin-bottom: 24px;
        }

        /* Review Modal specific styles */
        .review-modal-content {
          background-color: var(--card-bg);
          border: 1px solid var(--border-color);
          width: 100%;
          max-width: 600px;
          height: 80vh;
          height: 80dvh;
          border-radius: var(--radius-md);
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          animation: fadeInModal 0.25s ease-out;
        }

        .review-scroll-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          background-color: var(--bg-color);
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .review-intro {
          font-size: 13px;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 12px;
        }

        .review-section-item h4 {
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-secondary);
          margin-bottom: 12px;
          font-family: var(--font-sans);
          font-weight: 600;
        }

        .review-photos-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .review-photo-item {
          background-color: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          padding: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
        }

        .review-photo-item img {
          width: 100%;
          height: 120px;
          object-fit: cover;
          border-radius: 4px;
        }

        .review-photo-item img.grayscale,
        .review-photo-item-grid img.grayscale {
          filter: grayscale(100%);
        }

        .review-label-photo {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        .bw-badge-review {
          position: absolute;
          top: 36px;
          right: 20px;
          background-color: #000000;
          color: #FFFFFF;
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }

        .review-grid-small {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
          gap: 12px;
        }

        .review-photo-item-grid {
          position: relative;
          aspect-ratio: 3/4;
          background-color: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          padding: 4px;
        }

        .review-photo-item-grid img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 2px;
        }

        .bw-badge-review-small {
          position: absolute;
          top: 8px;
          right: 8px;
          background-color: #000000;
          color: #FFFFFF;
          font-size: 8px;
          padding: 1px 4px;
          border-radius: 3px;
          font-weight: 600;
        }

        .review-text-block {
          background-color: var(--bg-color);
          border: 1px solid var(--border-color);
          padding: 16px;
          border-radius: var(--radius-sm);
        }

        .review-quote-text {
          font-family: var(--font-serif);
          font-style: italic;
          color: var(--text-primary);
          font-size: 15px;
          margin-top: 4px;
        }

        .review-notes-text {
          font-size: 13px;
          color: var(--text-primary);
          margin-top: 4px;
        }

        .extra-price-review {
          font-size: 13px;
          color: #FAF9F6;
          margin-bottom: 8px;
        }

        /* ---------- shared bits (all sizes) ---------- */
        .alert-deadline {
          display: flex;
          align-items: center;
          gap: 10px;
          background-color: rgba(197, 168, 128, 0.08);
          border: 1px solid rgba(197, 168, 128, 0.2);
          padding: 14px 18px;
          border-radius: 6px;
          margin-bottom: 24px;
          color: #F3EDE7;
          font-size: 13px;
          font-weight: 500;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .config-section .form-input {
          padding: 10px 14px;
        }

        .name-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .name-grid > div {
          min-width: 0;
        }

        .album-type-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-top: 12px;
        }

        .album-type-card {
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #2D2A28;
          background-color: #161514;
          cursor: pointer;
          min-width: 0;
        }

        .album-type-card.selected {
          border: 2px solid #D4AF37;
          background-color: rgba(212, 175, 55, 0.1);
        }

        .album-type-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 6px;
        }

        .album-type-name {
          font-size: 16px;
          color: #FAF9F6;
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .album-type-price {
          color: #D4AF37;
          font-size: 16px;
          white-space: nowrap;
        }

        .album-type-desc {
          margin: 0;
          font-size: 12px;
          color: #A3A09B;
        }

        .photo-name {
          min-width: 0;
          max-width: 100%;
          font-size: 11px;
          line-height: 1.25;
          color: #D8D0C8;
          text-align: center;
          overflow-wrap: anywhere;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .selected-controls .photo-name {
          text-align: left;
          font-size: 12px;
        }

        .selected-card-compact {
          max-width: 280px;
        }

        .multi-picker-header {
          gap: 12px;
        }

        .multi-picker-text {
          min-width: 0;
        }

        .section-head-toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .section-head-toggle .section-title-wrapper {
          min-width: 0;
          flex: 1;
        }

        .section-head-toggle .toggle-switch-wrapper,
        .toggle-row .toggle-switch-wrapper {
          flex-shrink: 0;
        }

        .toggle-switch-wrapper::before {
          content: "";
          position: absolute;
          inset: -8px -4px;
        }

        .toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
          padding: 12px 16px;
          background-color: #161514;
          border-radius: 6px;
          border: 1px solid #2D2A28;
        }

        .toggle-row-text {
          font-size: 14px;
          color: #FAF9F6;
          font-weight: 500;
          min-width: 0;
        }

        .sonet-block {
          margin-bottom: 16px;
        }

        .custom-fields-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .custom-fields-list .form-group {
          margin-bottom: 0;
        }

        .custom-checkbox-row {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }

        .section-help {
          margin: -10px 0 16px;
          font-size: 13px;
          color: #706E6A;
        }

        .stepper-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }

        .stepper-btn {
          width: 40px;
          height: 40px;
          font-size: 20px;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          color: var(--text-primary);
          cursor: pointer;
          border-radius: var(--radius-sm);
        }

        .stepper-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .stepper-input {
          width: 80px;
          text-align: center;
        }

        .stepper-total {
          color: #FAF9F6;
          font-weight: 800;
          font-size: 16px;
        }

        .extra-pages-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-top: 18px;
        }

        .extra-page-card {
          border: 1px solid #2D2A28;
          border-radius: var(--radius-sm);
          background-color: #1C1A19;
          padding: 14px;
          min-width: 0;
        }

        .extra-page-card.complete {
          border-color: rgba(197, 168, 128, 0.45);
        }

        .extra-page-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .extra-page-card .thumbnails-grid {
          margin-top: 12px;
        }

        .extra-page-text {
          min-width: 0;
        }

        .review-extra-page {
          margin-top: 12px;
        }

        .review-extra-page .review-label-photo {
          display: block;
          margin-bottom: 6px;
        }

        .preview-caption {
          flex-shrink: 0;
          max-width: 100%;
          padding: 4px 12px;
          border-radius: 4px;
          background: rgba(14, 13, 12, 0.7);
          color: #F3EDE7;
          font-size: 13px;
          text-align: center;
          overflow-wrap: anywhere;
        }

        .preview-container .preview-large-image {
          min-height: 0;
        }

        .review-summary {
          background-color: #1C1A19;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #2D2A28;
        }

        .review-summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .review-summary-grid > div {
          min-width: 0;
        }

        .review-summary .review-label-photo {
          display: block;
          font-size: 11px;
          color: #A3A09B;
          margin-bottom: 0;
        }

        .review-section-item h4.review-summary-value {
          text-transform: none;
          letter-spacing: 0;
          margin: 2px 0 0 0;
          color: #FAF9F6;
          font-size: 15px;
          font-weight: 600;
          overflow-wrap: anywhere;
        }

        .review-section-item h4.review-summary-value.gold {
          color: #D4AF37;
        }

        .review-section-item h4.review-summary-value.total {
          font-size: 16px;
          font-weight: 700;
        }

        .review-photos-row-spaced {
          margin-bottom: 12px;
        }

        .review-text-block-gap {
          margin-top: 10px;
        }

        .review-voice-note {
          font-size: 13px;
          color: #D4AF37;
          margin: 0;
        }

        .review-photo-item .photo-name {
          margin-top: 6px;
        }

        .review-grid-cell {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .review-cost {
          background-color: var(--card-bg);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          padding: 12px 16px;
        }

        .review-cost h4 {
          margin-bottom: 8px;
        }

        .cost-line {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          padding: 5px 0;
          font-size: 13px;
          color: var(--text-primary);
        }

        .cost-line span:first-child {
          min-width: 0;
          color: var(--text-secondary);
        }

        .cost-line span:last-child {
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .cost-line.total {
          margin-top: 6px;
          padding-top: 10px;
          border-top: 1px solid var(--border-color);
          font-size: 16px;
          font-weight: 700;
        }

        .cost-line.total span:first-child {
          color: var(--text-primary);
        }

        .cost-line.total span:last-child {
          color: #D4AF37;
        }

        .review-overlay .review-modal-content .picker-modal-footer .btn {
          min-height: 44px;
        }

        /* ---------- Phones ---------- */
        @media (max-width: 480px) {
          .configurator-wrapper {
            overflow-x: hidden;
          }

          .config-header {
            padding: 10px 16px;
            gap: 8px 12px;
          }

          .back-btn-client {
            min-height: 40px;
            padding: 8px 12px;
          }

          .logo-placeholder img {
            height: 28px !important;
          }

          .header-details h2 {
            font-size: 15px;
            overflow-wrap: anywhere;
          }

          .teacher-name-label {
            overflow-wrap: anywhere;
          }

          .config-main {
            padding: 14px 16px calc(150px + env(safe-area-inset-bottom, 0px));
          }

          .alert-prepopulated,
          .alert-deadline {
            padding: 10px 12px;
            font-size: 12px;
            margin-bottom: 12px;
            align-items: flex-start;
            line-height: 1.4;
          }

          .alert-deadline svg {
            margin-top: 1px;
          }

          .steps-layout {
            gap: 12px;
          }

          .config-section {
            padding: 14px;
            border-radius: 10px;
            min-width: 0;
          }

          .section-title-wrapper {
            gap: 8px;
            margin-bottom: 12px;
            padding-bottom: 10px;
          }

          .section-title-wrapper h3 {
            font-size: 15px;
            line-height: 1.3;
            min-width: 0;
            overflow-wrap: anywhere;
          }

          .section-icon {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
          }

          .section-head-toggle {
            margin-bottom: 10px;
            gap: 10px;
          }

          .section-head-toggle .section-title-wrapper {
            border-bottom: none;
            padding-bottom: 0;
            margin-bottom: 0 !important;
          }

          .section-help {
            margin: -4px 0 12px;
            font-size: 12px;
            line-height: 1.4;
          }

          .config-section .form-group {
            margin-bottom: 0;
          }

          .config-section .form-label {
            font-size: 13px;
            letter-spacing: 0;
            text-transform: none;
            font-weight: 600;
            margin-bottom: 6px;
          }

          .config-section .form-input,
          .config-section .form-textarea-client {
            font-size: 16px;
          }

          .config-section .form-input {
            height: 44px;
            padding: 10px 12px;
          }

          .name-grid {
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .form-textarea-client {
            padding: 10px 12px;
            min-height: 88px;
          }

          .textarea-footer {
            gap: 8px;
          }

          .error-message-text {
            font-size: 12px;
            max-width: 85%;
          }

          /* Album type: compact selectable cards, one per row */
          .album-type-grid {
            grid-template-columns: 1fr;
            gap: 8px;
            margin-top: 0;
          }

          .album-type-card {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            column-gap: 10px;
            padding: 12px 14px;
            min-height: 56px;
          }

          .album-type-card.selected {
            padding: 11px 13px;
          }

          .album-type-top {
            display: contents;
          }

          .album-type-name {
            font-size: 15px;
            grid-column: 1;
            grid-row: 1;
          }

          .album-type-price {
            font-size: 15px;
            grid-column: 2;
            grid-row: 1;
          }

          .album-type-desc {
            grid-column: 1 / -1;
            grid-row: 2;
            margin-top: 2px;
          }

          /* Photos */
          .photo-picker-row {
            gap: 14px;
            margin-bottom: 16px;
          }

          .picker-label {
            font-size: 13px;
            letter-spacing: 0;
            text-transform: none;
            font-weight: 600;
            color: #D8D0C8;
          }

          .guideline-text {
            font-size: 12px;
            margin-top: 2px;
            line-height: 1.4;
          }

          .empty-picker-placeholder {
            height: 96px;
            gap: 6px;
            padding: 0 12px;
            text-align: center;
            font-size: 13px;
          }

          .empty-picker-placeholder.multi {
            height: 110px;
          }

          .empty-picker-placeholder svg {
            width: 26px;
            height: 26px;
          }

          .selected-card {
            padding: 10px;
            gap: 12px;
            align-items: flex-start;
          }

          .selected-card-compact {
            max-width: none;
          }

          .thumbnail-preview {
            width: 72px;
            height: 90px;
          }

          .selected-controls {
            gap: 6px;
            min-width: 0;
          }

          .bw-toggle-container {
            min-height: 40px;
            font-size: 13px;
          }

          .bw-checkbox-custom {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
          }

          .bw-checkbox-custom::after {
            left: 7px;
            top: 3px;
          }

          .btn-change {
            min-height: 40px;
            padding: 8px 14px;
            font-size: 12px;
            letter-spacing: 0.03em;
          }

          .multi-picker-container {
            padding-top: 14px;
          }

          .multi-picker-header {
            flex-direction: column;
            align-items: stretch;
            margin-bottom: 12px;
          }

          .multi-picker-header .btn,
          .extra-page-head .btn {
            width: 100%;
            min-height: 44px;
          }

          .extra-page-card {
            padding: 10px;
          }

          .extra-page-head {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
          }

          .extra-page-card .thumbnails-grid {
            margin-top: 10px;
          }

          .thumbnails-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
          }

          .thumbnail-card-grid {
            padding: 5px;
            gap: 4px;
            min-width: 0;
          }

          .bw-toggle-container-grid {
            min-height: 36px;
            font-size: 12px;
            gap: 6px;
          }

          .grid-controls {
            justify-content: flex-start;
          }

          /* Toggle rows */
          .toggle-row {
            padding: 10px 12px;
            margin-bottom: 10px;
          }

          .toggle-row-text {
            font-size: 14px;
            line-height: 1.35;
          }

          .sonet-block {
            margin-bottom: 12px;
          }

          .custom-fields-list {
            gap: 12px;
          }

          .custom-checkbox-row {
            min-height: 44px;
            font-size: 14px;
            line-height: 1.35;
          }

          .custom-checkbox-row input[type="checkbox"] {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
          }

          /* Stepper */
          .stepper-row {
            gap: 8px;
          }

          .stepper-btn {
            width: 44px;
            height: 44px;
          }

          .stepper-input {
            width: 64px;
          }

          .stepper-total {
            font-size: 15px;
            margin-left: 4px;
          }

          /* Sticky action bar */
          .configurator-footer-bar {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
            padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
          }

          .requirements-summary {
            gap: 4px 12px;
            justify-content: center;
          }

          .req-item {
            font-size: 11px;
          }

          .btn-submit-album {
            width: 100%;
            min-width: 0;
            height: 46px;
          }

          /* Full-image preview */
          .preview-container {
            padding: 56px 8px 16px;
            box-sizing: border-box;
          }

          .preview-close-btn {
            top: 8px;
            right: 8px;
            width: 44px;
            height: 44px;
          }

          /* Submitting / success */
          .submitting-overlay {
            padding: 16px;
          }

          .submitting-card,
          .success-card {
            padding: 24px 18px;
          }

          .success-card h3,
          .submitting-card h3 {
            font-size: 20px;
          }

          .success-card p,
          .submitting-card p {
            font-size: 13px;
            margin-bottom: 16px;
          }

          .success-icon {
            width: 48px;
            height: 48px;
          }

          /* Review sheet: full screen */
          .picker-modal-overlay.review-overlay {
            padding: 0;
            align-items: stretch;
          }

          .review-modal-content {
            height: 100vh;
            height: 100dvh;
            max-width: none;
            border-radius: 0;
            border: none;
          }

          .review-overlay .picker-modal-header {
            padding: 12px 16px;
            padding-top: calc(12px + env(safe-area-inset-top, 0px));
          }

          .review-overlay .picker-modal-header h3 {
            font-size: 16px;
          }

          .review-overlay .picker-close-btn {
            width: 44px;
            height: 44px;
            margin: -10px -10px -10px 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .review-scroll-body {
            padding: 14px 16px;
            gap: 14px;
          }

          .review-intro {
            font-size: 12px;
            padding-bottom: 8px;
          }

          .review-section-item h4 {
            font-size: 12px;
            letter-spacing: 0.03em;
            margin-bottom: 8px;
          }

          .review-summary {
            padding: 12px;
          }

          .review-summary-grid {
            gap: 10px;
          }

          .review-photos-row {
            gap: 10px;
          }

          .review-photo-item {
            padding: 8px;
            min-width: 0;
          }

          .review-photo-item img {
            height: 110px;
          }

          .bw-badge-review {
            top: 30px;
            right: 14px;
          }

          .review-grid-small {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
          }

          .review-text-block {
            padding: 10px 12px;
          }

          .review-text-block .review-label-photo {
            display: block;
            line-height: 1.3;
            margin-bottom: 2px;
          }

          .review-quote-text {
            font-size: 14px;
            overflow-wrap: anywhere;
          }

          .review-notes-text {
            overflow-wrap: anywhere;
          }

          .review-overlay .picker-modal-footer {
            gap: 8px;
            padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
          }

          .review-overlay .picker-modal-footer .btn {
            flex: 1;
            padding: 10px 12px;
            font-size: 12px;
            letter-spacing: 0.03em;
          }

          .review-overlay .picker-modal-footer .btn-gold {
            flex: 1.4;
          }
        }

        @media (max-width: 360px) {
          .config-main {
            padding-left: 12px;
            padding-right: 12px;
          }

          .config-section {
            padding: 12px;
          }

          .stepper-btn {
            width: 42px;
          }

          .stepper-input {
            width: 56px;
          }

          .review-photo-item img {
            height: 96px;
          }
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
