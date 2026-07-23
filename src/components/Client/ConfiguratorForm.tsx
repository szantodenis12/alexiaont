import React, { useState } from 'react';
import { db, storage } from '../../firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { containsProfanity } from '../../utils/profanityFilter';
import { convertToGrayscale } from '../../utils/imageProcessor';
import { PhotoPickerModal } from './PhotoPickerModal';
import { 
  ArrowLeft, Image as ImageIcon, RefreshCw, 
  Sparkles, BookOpen, CheckCircle2, X, Lock
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
  galleryPhotos: Photo[];
  deadline?: any;
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
  // State for selections
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
  const [observatii, setObservatii] = useState(existingSubmission?.observatii || '');
  
  const [extraPagesEnabled, setExtraPagesEnabled] = useState(
    existingSubmission?.extraPagesEnabled || false
  );
  const [extraPhotos, setExtraPhotos] = useState<PhotoSelection[]>(
    existingSubmission?.extraPhotos 
      ? existingSubmission.extraPhotos.map((p: any) => ({ url: p.url, bw: p.bw })) 
      : []
  );

  // Modals state
  const [pickerConfig, setPickerConfig] = useState<{
    isOpen: boolean;
    field: 'coperta' | 'colegi' | 'personal' | 'extra';
    multiple: boolean;
    minRequired: number;
  } | null>(null);

  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  
  const isPreviewGrayscale = () => {
    if (!previewPhotoUrl) return false;
    if (copertaPhoto?.url === previewPhotoUrl) return copertaPhoto.bw;
    if (colegiPhoto?.url === previewPhotoUrl) return colegiPhoto.bw;
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

  // Validate form requirements
  const isFormValid = () => {
    return (
      copertaPhoto !== null &&
      colegiPhoto !== null &&
      personalPhotos.length >= 4 &&
      !hasCitatProfanity
    );
  };

  const openPicker = (field: 'coperta' | 'colegi' | 'personal' | 'extra', multiple = false, minRequired = 1) => {
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

  const toggleBw = (field: 'coperta' | 'colegi' | 'personal' | 'extra', index?: number) => {
    if (field === 'coperta' && copertaPhoto) {
      setCopertaPhoto({ ...copertaPhoto, bw: !copertaPhoto.bw });
    } else if (field === 'colegi' && colegiPhoto) {
      setColegiPhoto({ ...colegiPhoto, bw: !colegiPhoto.bw });
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

      // 4. Process Extra Photos if enabled
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

      // 5. Save submission to Firestore
      setSubmitStepText('Se salvează configurarea în baza de date...');
      const submissionId = `${classData.id}_${studentName}`;
      await setDoc(doc(db, 'submissions', submissionId), {
        classId: classData.id,
        studentName,
        albumName: albumName.trim() || studentName,
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
        observatii: observatii.trim(),
        extraPagesEnabled,
        extraPhotos: extraPhotos.map((p, idx) => ({
          url: p.url,
          processedUrl: extraProcessed[idx].processedUrl,
          bw: p.bw,
          name: getPhotoNameFromUrl(p.url)
        })),
        submittedAt: new Date()
      });

      setSubmitStepText('Finalizat cu succes!');
      setShowSuccess(true);

    } catch (err) {
      console.error('Submission failed:', err);
      alert('Trimiterea a eșuat. Te rugăm să încerci din nou sau să contactezi fotograful.');
    } finally {
      setIsSubmitting(false);
    }
  };



  const getSelectedPhotos = (field: 'coperta' | 'colegi' | 'personal' | 'extra') => {
    if (field === 'coperta') return copertaPhoto ? [copertaPhoto] : [];
    if (field === 'colegi') return colegiPhoto ? [colegiPhoto] : [];
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

          {/* Section 2: Optional Details */}
          <div className="config-section">
            <div className="section-title-wrapper">
              <Sparkles size={20} className="section-icon" />
              <h3>2. Citat & Observații (Opțional)</h3>
            </div>

            <div className="form-group">
              <label className="form-label">Citat Album</label>
              <textarea
                rows={3}
                placeholder="Introdu citatul tău preferat pentru album..."
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

            <div className="form-group">
              <label className="form-label">Observații pentru Designer</label>
              <textarea
                rows={3}
                placeholder="Ex: aș dori ca poza X să fie pe o pagină completă, corecții de retuș etc."
                value={observatii}
                onChange={(e) => setObservatii(e.target.value)}
                className="form-textarea-client"
                maxLength={500}
              />
              <span className="char-count-right">{observatii.length}/500</span>
            </div>
          </div>

          {/* Section 3: Extra Pages */}
          <div className="config-section">
            <div className="extra-pages-header-row">
              <div className="section-title-wrapper">
                <BookOpen size={20} className="section-icon" />
                <h3>3. Pagini Suplimentare (Opțional)</h3>
              </div>
              <label className="toggle-switch-wrapper">
                <input 
                  type="checkbox" 
                  checked={extraPagesEnabled}
                  onChange={() => setExtraPagesEnabled(!extraPagesEnabled)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {extraPagesEnabled && (
              <div className="extra-pages-content animate-slide">
                <div className="price-banner">
                  <span>Preț pagină suplimentară: <strong>{classData.extraPagesPrice} RON</strong></span>
                  {extraPhotos.length > 0 && (
                    <span className="total-calculation">
                      Cost estimat: <strong>{extraPhotos.length * classData.extraPagesPrice} RON</strong> pentru {extraPhotos.length} poze.
                    </span>
                  )}
                </div>

                <div className="multi-picker-container" style={{ marginTop: '20px' }}>
                  <div className="multi-picker-header">
                    <div>
                      <span className="picker-label">Fotografii pentru pagini extra</span>
                      <p className="guideline-text">Alege pozele pe care dorești să le incluzi pe paginile suplimentare.</p>
                    </div>
                    <button 
                      onClick={() => openPicker('extra', true, 1)} 
                      className="btn btn-secondary btn-sm"
                    >
                      {extraPhotos.length > 0 ? 'Gestionează Poze' : 'Alege Poze'}
                    </button>
                  </div>

                  {extraPhotos.length > 0 ? (
                    <div className="thumbnails-grid">
                      {extraPhotos.map((photo, index) => (
                        <div key={photo.url} className="thumbnail-card-grid">
                          <div 
                            className={`grid-thumbnail ${photo.bw ? 'grayscale' : ''}`}
                            onClick={() => setPreviewPhotoUrl(photo.url)}
                            title="Click pentru a mări"
                          >
                            <img src={photo.url} alt={`Extra ${index + 1}`} />
                          </div>
                          <div className="grid-controls">
                            <label className="bw-toggle-container-grid">
                              <input 
                                type="checkbox" 
                                checked={photo.bw}
                                onChange={() => toggleBw('extra', index)}
                              />
                              <span className="bw-checkbox-custom"></span>
                              <span className="bw-label-text">B/W</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div onClick={() => openPicker('extra', true, 1)} className="empty-picker-placeholder multi">
                      <ImageIcon size={36} />
                      <span>Selectează Fotografii Suplimentare</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
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
              <p className="review-intro">Verifică cu atenție selecțiile făcute înainte de a le trimite.</p>
              
              <div className="review-section-item">
                <h4>Fotografii de bază</h4>
                <div className="review-photos-row">
                  <div className="review-photo-item">
                    <span className="review-label-photo">Copertă</span>
                    <img src={copertaPhoto?.url} alt="Coperta" className={copertaPhoto?.bw ? 'grayscale' : ''} />
                    {copertaPhoto?.bw && <span className="bw-badge-review">B/W</span>}
                  </div>
                  <div className="review-photo-item">
                    <span className="review-label-photo">Colegi</span>
                    <img src={colegiPhoto?.url} alt="Colegi" className={colegiPhoto?.bw ? 'grayscale' : ''} />
                    {colegiPhoto?.bw && <span className="bw-badge-review">B/W</span>}
                  </div>
                </div>
              </div>

              <div className="review-section-item">
                <h4>Fotografii personale ({personalPhotos.length})</h4>
                <div className="review-grid-small">
                  {personalPhotos.map((p, idx) => (
                    <div key={idx} className="review-photo-item-grid">
                      <img src={p.url} alt={`Personal ${idx}`} className={p.bw ? 'grayscale' : ''} />
                      {p.bw && <span className="bw-badge-review-small">B/W</span>}
                    </div>
                  ))}
                </div>
              </div>

              {(citat.trim() || observatii.trim()) && (
                <div className="review-section-item">
                  <h4>Text & Citat</h4>
                  {citat.trim() && (
                    <div className="review-text-block">
                      <span className="review-label-photo">Citat:</span>
                      <p className="review-quote-text">„{citat}”</p>
                    </div>
                  )}
                  {observatii.trim() && (
                    <div className="review-text-block" style={{ marginTop: '12px' }}>
                      <span className="review-label-photo">Observații pentru designer:</span>
                      <p className="review-notes-text">{observatii}</p>
                    </div>
                  )}
                </div>
              )}

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
