import React, { useState } from 'react';
import { db, storage } from '../../firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { containsProfanity } from '../../utils/profanityFilter';
import { convertToGrayscale } from '../../utils/imageProcessor';
import { PhotoPickerModal } from './PhotoPickerModal';
import { VoiceRecorder } from '../Common/VoiceRecorder';
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
  galleryPhotos: Photo[];
  deadline?: any;
  enableVoiceMessage?: boolean;
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
}

export const ConfiguratorForm: React.FC<ConfiguratorFormProps> = ({
  classData,
  studentName,
  albumName,
  existingSubmission,
  onBack
}) => {
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

  const [hasSonet] = useState<boolean>(
    existingSubmission?.hasSonet || false
  );
  const [extraPagesEnabled] = useState(
    existingSubmission?.extraPagesEnabled || false
  );
  const [extraPhotos, setExtraPhotos] = useState<PhotoSelection[]>(
    existingSubmission?.extraPhotos 
      ? existingSubmission.extraPhotos.map((p: any) => ({ url: p.url, bw: p.bw })) 
      : []
  );

  const [voiceAudioBlob, setVoiceAudioBlob] = useState<Blob | null>(null);
  const [voiceWaveform, setVoiceWaveform] = useState<number[]>(existingSubmission?.voiceWaveform || []);

  // Modals state
  const [pickerConfig, setPickerConfig] = useState<{
    isOpen: boolean;
    field: 'coperta' | 'colegi' | 'personal' | 'extra' | 'poster' | 'sonet';
    multiple: boolean;
    minRequired: number;
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
    const extraFound = extraPhotos.find(p => p.url === previewPhotoUrl);
    if (extraFound) return extraFound.bw;
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
      !hasCitatProfanity
    );
  };

  const openPicker = (field: 'coperta' | 'colegi' | 'personal' | 'extra' | 'poster' | 'sonet', multiple = false, minRequired = 1) => {
    setPickerConfig({
      isOpen: true,
      field,
      multiple,
      minRequired
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
    } else if (pickerConfig.field === 'extra') {
      const updated = urls.map(url => {
        const existing = extraPhotos.find(p => p.url === url);
        return { url, bw: isBw(url, existing ? existing.bw : false) };
      });
      setExtraPhotos(updated);
    }
  };

  const toggleBw = (field: 'coperta' | 'colegi' | 'personal' | 'extra' | 'poster' | 'sonet', index?: number) => {
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
    } else if (field === 'extra' && typeof index === 'number') {
      const updated = [...extraPhotos];
      updated[index] = { ...updated[index], bw: !updated[index].bw };
      setExtraPhotos(updated);
    }
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

      // 6. Process Extra Photos if enabled
      const extraProcessed: any[] = [];
      if (extraPagesEnabled && extraPhotos.length > 0) {
        setSubmitStepText('Se procesează pozele pentru pagini extra...');
        for (let i = 0; i < extraPhotos.length; i++) {
          setSubmitStepText(`Se procesează poza extra ${i + 1}/${extraPhotos.length}...`);
          const processedUrl = await processAndUploadIfBw(extraPhotos[i], `extra_${i}`);
          extraProcessed.push({
            url: extraPhotos[i].url,
            processedUrl,
            bw: extraPhotos[i].bw
          });
        }
      }

      // Helper to find photo name
      const getPhotoNameFromUrl = (url: string): string => {
        const found = classData.galleryPhotos.find(p => p.url === url);
        return found ? found.name : 'photo.jpg';
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
      const extraPrice = extraPagesEnabled ? (extraPhotos.length * classData.extraPagesPrice) : 0;
      const totalCost = baseAlbumPrice + sonetPrice + extraPrice;

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
        extraPagesEnabled,
        extraPhotos: extraPhotos.map((p, idx) => ({
          url: p.url,
          processedUrl: extraProcessed[idx].processedUrl,
          bw: p.bw,
          name: getPhotoNameFromUrl(p.url)
        })),
        ...(voiceMessageUrl ? { voiceMessageUrl, voiceMessagePath } : {}),
        ...(voiceWaveform.length > 0 ? { voiceWaveform } : {}),
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



  const getSelectedPhotos = (field: 'coperta' | 'colegi' | 'personal' | 'extra' | 'poster' | 'sonet') => {
    if (field === 'coperta') return copertaPhoto ? [copertaPhoto] : [];
    if (field === 'colegi') return colegiPhoto ? [colegiPhoto] : [];
    if (field === 'poster') return posterPhoto ? [posterPhoto] : [];
    if (field === 'sonet') return sonetPhoto ? [sonetPhoto] : [];
    if (field === 'personal') return personalPhotos;
    return extraPhotos;
  };

  return (
    <div className="configurator-wrapper">
      {/* Read-only Header */}
      <header className="config-header">
        <button onClick={onBack} className="back-btn-client">
          <ArrowLeft size={16} /> Înapoi
        </button>
        <div className="header-details">
          <h2>{classData.schoolName}</h2>
          <p className="teacher-name-label">Elev: <span className="student-highlight">{studentName}</span> | Diriginte: {classData.diriginteName}</p>
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
          <div className="alert-deadline" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: 'rgba(197, 168, 128, 0.08)',
            border: '1px solid rgba(197, 168, 128, 0.2)',
            padding: '14px 18px',
            borderRadius: '6px',
            marginBottom: '24px',
            color: '#F3EDE7',
            fontSize: '13px',
            fontWeight: 500,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
          }}>
            <Lock size={16} style={{ color: '#5f0b02', flexShrink: 0 }} />
            <span>Te rugăm să trimiți selecția ta până la data de: <strong>{classData.deadline.toDate ? classData.deadline.toDate().toLocaleDateString('ro-RO') : new Date(classData.deadline).toLocaleDateString('ro-RO')}</strong>. După această dată, configuratorul se va bloca automat.</span>
          </div>
        )}

        <div className="steps-layout">
          {/* PASUL 1 & 2: Identificare & Nume pe Album */}
          <div className="config-section">
            <div className="section-title-wrapper">
              <Sparkles size={20} className="section-icon" />
              <h3>1 & 2. Numele Tău & Numele pe Album</h3>
            </div>
            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label className="form-label" style={{ fontSize: '12px', color: '#A3A09B' }}>1. Nume Elev (Selectat din listă)</label>
                <input type="text" readOnly value={studentName} className="form-input" style={{ backgroundColor: '#161514', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '10px 14px', borderRadius: '6px', width: '100%' }} />
              </div>
              <div>
                <label className="form-label" style={{ fontSize: '12px', color: '#A3A09B' }}>2. Nume Dorit pe Album (Printat)</label>
                <input 
                  type="text" 
                  value={customAlbumName} 
                  onChange={(e) => setCustomAlbumName(e.target.value)} 
                  placeholder={studentName}
                  className="form-input" 
                  style={{ backgroundColor: '#1C1A19', color: '#FAF9F6', border: '1px solid #2D2A28', padding: '10px 14px', borderRadius: '6px', width: '100%' }} 
                />
              </div>
            </div>
          </div>

          {/* PASUL 8: Alegere Pachet Album (MARE x lei / MIC y lei) */}
          {classData.albumTypesEnabled !== false && (
            <div className="config-section">
              <div className="section-title-wrapper">
                <Sparkles size={20} className="section-icon" style={{ color: 'var(--gold-accent)' }} />
                <h3>Alege Pachetul de Album</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
                <div 
                  onClick={() => setSelectedAlbumType('mare')}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: selectedAlbumType === 'mare' ? '2px solid #D4AF37' : '1px solid #2D2A28',
                    backgroundColor: selectedAlbumType === 'mare' ? 'rgba(212,175,55,0.1)' : '#161514',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '16px', color: '#FAF9F6', display: 'flex', alignItems: 'center', gap: '7px' }}>{selectedAlbumType === 'mare' && <CheckCircle2 size={15} style={{ color: '#D4AF37', flexShrink: 0 }} />}ALBUM MARE</strong>
                    <strong style={{ color: '#D4AF37', fontSize: '16px' }}>{classData.priceAlbumMare ?? 150} LEI</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: '#A3A09B' }}>
                    Pachet album format mare.
                  </p>
                </div>

                <div 
                  onClick={() => setSelectedAlbumType('mic')}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: selectedAlbumType === 'mic' ? '2px solid #D4AF37' : '1px solid #2D2A28',
                    backgroundColor: selectedAlbumType === 'mic' ? 'rgba(212,175,55,0.1)' : '#161514',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '16px', color: '#FAF9F6', display: 'flex', alignItems: 'center', gap: '7px' }}>{selectedAlbumType === 'mic' && <CheckCircle2 size={15} style={{ color: '#D4AF37', flexShrink: 0 }} />}ALBUM MIC</strong>
                    <strong style={{ color: '#D4AF37', fontSize: '16px' }}>{classData.priceAlbumMic ?? 100} LEI</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: '12px', color: '#A3A09B' }}>
                    Pachet album format mic.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Section 1: Required Photos */}
          <div className="config-section">
            <div className="section-title-wrapper">
              <BookOpen size={20} className="section-icon" />
              <h3>1. Fotografii Obligatorii</h3>
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
                      <img src={copertaPhoto.url} alt="Coperta" />
                    </div>
                    <div className="selected-controls">
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
                      <img src={colegiPhoto.url} alt="Colegi" />
                    </div>
                    <div className="selected-controls">
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
                <div>
                  <span className="picker-label">Fotografii Personale (Minim 4 poze)</span>
                  <p className="guideline-text">~10 fotografii recomandate pentru o așezare optimă în pagină.</p>
                </div>
                <button 
                  onClick={() => openPicker('personal', true, 4)} 
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
                        <img src={photo.url} alt={`Personal ${index + 1}`} />
                      </div>
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
                <div onClick={() => openPicker('personal', true, 4)} className="empty-picker-placeholder multi">
                  <ImageIcon size={36} />
                  <span>Selectează Fotografii Personale (Minim 4)</span>
                </div>
              )}
            </div>
          </div>

          {/* PASUL 6: Citat Album */}
          <div className="config-section">
            <div className="section-title-wrapper">
              <Sparkles size={20} className="section-icon" />
              <h3>6. Citat Album</h3>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div className="section-title-wrapper" style={{ margin: 0 }}>
                  <Sparkles size={20} className="section-icon" />
                  <h3>7. Ai observații de spus pentru designer?</h3>
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

          {/* PASUL 8: Poză pentru Poster (Toggle ON/OFF) */}
          {classData.enablePoster !== false && (
            <div className="config-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div className="section-title-wrapper" style={{ margin: 0 }}>
                  <ImageIcon size={20} className="section-icon" />
                  <h3>8. Poză pentru Poster</h3>
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
                    <div className="selected-card" style={{ maxWidth: '280px' }}>
                      <div className={`thumbnail-preview ${posterPhoto.bw ? 'grayscale' : ''}`} onClick={() => setPreviewPhotoUrl(posterPhoto.url)}>
                        <img src={posterPhoto.url} alt="Poster" />
                      </div>
                      <div className="selected-controls">
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
              <div className="section-title-wrapper" style={{ marginBottom: '16px' }}>
                <BookOpen size={20} className="section-icon" style={{ color: 'var(--gold-accent)' }} />
                <h3>9 & 10. Sonet Școlar (+{classData.priceSonet ?? 25} LEI)</h3>
              </div>

              {/* 9. Poză pt Sonet */}
              {classData.enableSonetPhoto !== false && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', padding: '12px 16px', backgroundColor: '#161514', borderRadius: '6px', border: '1px solid #2D2A28' }}>
                    <span style={{ fontSize: '14px', color: '#FAF9F6', fontWeight: 500 }}>9. Adaugă Poză pentru Sonet?</span>
                    <label className="toggle-switch-wrapper" style={{ margin: 0 }}>
                      <input type="checkbox" checked={wantsSonetPhoto} onChange={(e) => setWantsSonetPhoto(e.target.checked)} />
                      <span className="slider round"></span>
                    </label>
                  </div>

                  {wantsSonetPhoto && (
                    <div style={{ marginTop: '8px' }}>
                      {sonetPhoto ? (
                        <div className="selected-card" style={{ maxWidth: '280px' }}>
                          <div className={`thumbnail-preview ${sonetPhoto.bw ? 'grayscale' : ''}`} onClick={() => setPreviewPhotoUrl(sonetPhoto.url)}>
                            <img src={sonetPhoto.url} alt="Sonet" />
                          </div>
                          <div className="selected-controls">
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', padding: '12px 16px', backgroundColor: '#161514', borderRadius: '6px', border: '1px solid #2D2A28' }}>
                    <span style={{ fontSize: '14px', color: '#FAF9F6', fontWeight: 500 }}>10. Adaugă Citat special pentru Sonet?</span>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div className="section-title-wrapper" style={{ margin: 0 }}>
                  <Sparkles size={20} className="section-icon" />
                  <h3>11. Dorești să cumperi lucruri extra în plus? (canvas, poze scoase etc.)</h3>
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

          {/* Section 4: Voice Message (if enabled for class) */}
          {classData.enableVoiceMessage && (
            <div className="config-section">
              <div className="section-title-wrapper">
                <Mic size={20} className="section-icon" style={{ color: 'var(--gold-accent)' }} />
                <h3>4. Mesaj Vocal Album (Opțional, max. 1 min)</h3>
              </div>
              <p style={{ margin: '-10px 0 16px', fontSize: '13px', color: '#706E6A' }}>
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
            {personalPhotos.length < 4 ? (
              <span className="req-item missing">• Poze Personale ({personalPhotos.length}/4)</span>
            ) : (
              <span className="req-item met">✓ Poze Personale ({personalPhotos.length})</span>
            )}
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
          selectedPhotos={getSelectedPhotos(pickerConfig.field)}
          onConfirm={handlePickerConfirm}
          multiple={pickerConfig.multiple}
          minRequired={pickerConfig.minRequired}
          fieldKey={`${classData.id}_${pickerConfig.field}`}
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
          </div>
        </div>
      )}

      {/* 3. Review Dialog */}
      {showReview && (
        <div className="picker-modal-overlay">
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
              <div className="review-section-item" style={{ backgroundColor: '#1C1A19', padding: '16px', borderRadius: '8px', border: '1px solid #2D2A28' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <span className="review-label-photo" style={{ fontSize: '11px', color: '#A3A09B' }}>Nume Elev:</span>
                    <h4 style={{ margin: '2px 0 0 0', color: '#FAF9F6', fontSize: '15px' }}>{studentName}</h4>
                  </div>
                  <div>
                    <span className="review-label-photo" style={{ fontSize: '11px', color: '#A3A09B' }}>Nume Dorit pe Album:</span>
                    <h4 style={{ margin: '2px 0 0 0', color: 'var(--gold-accent)', fontSize: '15px' }}>{customAlbumName.trim() || studentName}</h4>
                  </div>
                  {classData.albumTypesEnabled !== false && (
                    <div>
                      <span className="review-label-photo" style={{ fontSize: '11px', color: '#A3A09B' }}>Pachet Album:</span>
                      <h4 style={{ margin: '2px 0 0 0', color: '#FAF9F6', fontSize: '14px', textTransform: 'uppercase' }}>
                        {selectedAlbumType === 'mic' ? 'Album Mic' : 'Album Mare'}
                      </h4>
                    </div>
                  )}
                  <div>
                    <span className="review-label-photo" style={{ fontSize: '11px', color: '#A3A09B' }}>Cost Total Estimat:</span>
                    <h4 style={{ margin: '2px 0 0 0', color: 'var(--gold-accent)', fontSize: '16px', fontWeight: 700 }}>
                      {(() => {
                        const baseAlbumPrice = classData.albumTypesEnabled !== false
                          ? (selectedAlbumType === 'mare' ? (classData.priceAlbumMare ?? 150) : (classData.priceAlbumMic ?? 100))
                          : 0;
                        const sonetPrice = classData.enableSonete !== false && (hasSonet || wantsSonetPhoto || wantsSonetCitat) ? (classData.priceSonet ?? 25) : 0;
                        const extraPrice = extraPagesEnabled ? (extraPhotos.length * classData.extraPagesPrice) : 0;
                        return baseAlbumPrice + sonetPrice + extraPrice;
                      })()} LEI
                    </h4>
                  </div>
                </div>
              </div>

              {/* Cover & Classmates photos */}
              <div className="review-section-item">
                <h4>Fotografii Obligatorii</h4>
                <div className="review-photos-row">
                  <div className="review-photo-item">
                    <span className="review-label-photo">3. Copertă</span>
                    <img src={copertaPhoto?.url} alt="Coperta" className={copertaPhoto?.bw ? 'grayscale' : ''} />
                    {copertaPhoto?.bw && <span className="bw-badge-review">B/W</span>}
                  </div>
                  <div className="review-photo-item">
                    <span className="review-label-photo">4. Colegi</span>
                    <img src={colegiPhoto?.url} alt="Colegi" className={colegiPhoto?.bw ? 'grayscale' : ''} />
                    {colegiPhoto?.bw && <span className="bw-badge-review">B/W</span>}
                  </div>
                </div>
              </div>

              {/* Personal photos */}
              <div className="review-section-item">
                <h4>5. Fotografii Personale ({personalPhotos.length} poze)</h4>
                <div className="review-grid-small">
                  {personalPhotos.map((p, idx) => (
                    <div key={idx} className="review-photo-item-grid">
                      <img src={p.url} alt={`Personal ${idx}`} className={p.bw ? 'grayscale' : ''} />
                      {p.bw && <span className="bw-badge-review-small">B/W</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Poster Photo if selected */}
              {wantsPoster && posterPhoto && (
                <div className="review-section-item">
                  <h4>8. Poză pentru Poster</h4>
                  <div className="review-photos-row">
                    <div className="review-photo-item">
                      <img src={posterPhoto.url} alt="Poster" className={posterPhoto.bw ? 'grayscale' : ''} />
                      {posterPhoto.bw && <span className="bw-badge-review">B/W</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Sonete Școlare if selected */}
              {classData.enableSonete !== false && (wantsSonetPhoto || wantsSonetCitat || hasSonet) && (
                <div className="review-section-item">
                  <h4>9 & 10. Sonet Școlar</h4>
                  {wantsSonetPhoto && sonetPhoto && (
                    <div className="review-photos-row" style={{ marginBottom: '12px' }}>
                      <div className="review-photo-item">
                        <span className="review-label-photo">Poză Sonet</span>
                        <img src={sonetPhoto.url} alt="Sonet" className={sonetPhoto.bw ? 'grayscale' : ''} />
                        {sonetPhoto.bw && <span className="bw-badge-review">B/W</span>}
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
                  <h4>6 & 7. Text & Observații</h4>
                  {citat.trim() && (
                    <div className="review-text-block">
                      <span className="review-label-photo">Citat Album:</span>
                      <p className="review-quote-text">„{citat}”</p>
                    </div>
                  )}
                  {hasObservatiiToggle && observatii.trim() && (
                    <div className="review-text-block" style={{ marginTop: '12px' }}>
                      <span className="review-label-photo">Observații pentru designer:</span>
                      <p className="review-notes-text">{observatii}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Extra Items if requested */}
              {wantsExtraItems && extraItemsText.trim() && (
                <div className="review-section-item">
                  <h4>11. Cumpărături Extra (Produse suplimentare)</h4>
                  <div className="review-text-block">
                    <p className="review-notes-text" style={{ fontStyle: 'normal' }}>{extraItemsText}</p>
                  </div>
                </div>
              )}

              {/* Extra Pages */}
              {extraPagesEnabled && extraPhotos.length > 0 && (
                <div className="review-section-item">
                  <h4>Pagini Extra ({extraPhotos.length} poze)</h4>
                  <p className="extra-price-review">Cost suplimentar estimat: <strong>{extraPhotos.length * classData.extraPagesPrice} RON</strong></p>
                  <div className="review-grid-small">
                    {extraPhotos.map((p, idx) => (
                      <div key={idx} className="review-photo-item-grid">
                        <img src={p.url} alt={`Extra ${idx}`} className={p.bw ? 'grayscale' : ''} />
                        {p.bw && <span className="bw-badge-review-small">B/W</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Voice Message */}
              {voiceAudioBlob && (
                <div className="review-section-item">
                  <h4>Mesaj Vocal Audio</h4>
                  <p style={{ fontSize: '13px', color: 'var(--gold-accent)', margin: 0 }}>✓ Mesaj vocal înregistrat (va fi atașat pe codul QR al albumului)</p>
                </div>
              )}
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
          color: var(--gold-accent);
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
          color: var(--gold-accent);
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
          width: 100vw;
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
          width: 100vw;
          height: 100vh;
          background: rgba(14, 13, 12, 0.95);
          z-index: 1100;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: zoom-out;
        }

        .preview-container {
          position: relative;
          width: 100vw;
          height: 100vh;
          display: flex;
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
          width: 100vw;
          height: 100vh;
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
          font-size: 12px;
          color: var(--gold-accent);
          margin-bottom: 8px;
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
