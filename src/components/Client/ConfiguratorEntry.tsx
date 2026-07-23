import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { ConfiguratorForm } from './ConfiguratorForm';
import { Lock, RefreshCw, AlertCircle, User, ChevronRight, ChevronDown } from 'lucide-react';

interface ClassData {
  id: string;
  schoolName: string;
  diriginteName: string;
  studentList: string[];
  status: 'active' | 'locked';
  requireEmailDownload: boolean;
  extraPagesPrice: number;
  galleryPhotos: any[];
  deadline?: any;
}

export const ConfiguratorEntry: React.FC = () => {
  const { classId } = useParams<{ classId: string }>();
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [selectedStudent, setSelectedStudent] = useState('');
  const [albumName, setAlbumName] = useState('');
  const [existingSubmission, setExistingSubmission] = useState<any | null>(null);
  const [checkingSubmission, setCheckingSubmission] = useState(false);
  const [step, setStep] = useState<'select' | 'form'>('select');

  useEffect(() => {
    const fetchClass = async () => {
      if (!classId) {
        setError('ID-ul clasei lipsește.');
        setLoading(false);
        return;
      }

      try {
        const classDoc = await getDoc(doc(db, 'classes', classId));
        if (classDoc.exists()) {
          const data = classDoc.data() as Omit<ClassData, 'id'>;
          setClassData({ id: classDoc.id, ...data });
        } else {
          setError('Clasa nu a fost găsită. Te rugăm să verifici link-ul.');
        }
      } catch (err) {
        console.error('Error fetching class:', err);
        setError('A apărut o eroare la încărcarea datelor clasei.');
      } finally {
        setLoading(false);
      }
    };

    fetchClass();
  }, [classId]);

  // Debounced checker for existing submissions
  useEffect(() => {
    const studentName = selectedStudent.trim();
    if (!studentName || studentName.length < 3 || !classId) {
      setExistingSubmission(null);
      setAlbumName('');
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingSubmission(true);
      try {
        const submissionDoc = await getDoc(doc(db, 'submissions', `${classId}_${studentName}`));
        if (submissionDoc.exists()) {
          const data = submissionDoc.data();
          setExistingSubmission(data);
          setAlbumName(data.albumName || studentName);
        } else {
          setExistingSubmission(null);
          setAlbumName(studentName);
        }
      } catch (err) {
        console.error('Error checking submission:', err);
      } finally {
        setCheckingSubmission(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [selectedStudent, classId]);

  const handleStart = () => {
    if (!selectedStudent || selectedStudent.trim().length < 3) return;
    setStep('form');
  };

  if (loading) {
    return (
      <div className="client-loading-wrapper">
        <RefreshCw className="spinner" size={32} />
        <p>Se încarcă detaliile clasei...</p>
        <style>{`
          .client-loading-wrapper {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: #FAF9F6;
            color: #1F1E1C;
            gap: 16px;
          }
          .spinner {
            animation: spin 1s linear infinite;
            color: #8C765C;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="client-error-wrapper">
        <AlertCircle size={48} className="error-icon" />
        <h2>Eroare link</h2>
        <p>{error}</p>
        <style>{`
          .client-error-wrapper {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: #FAF9F6;
            color: #1F1E1C;
            padding: 24px;
            text-align: center;
          }
          .error-icon {
            color: #A94442;
            margin-bottom: 16px;
          }
          .client-error-wrapper h2 {
            font-size: 24px;
            margin-bottom: 8px;
          }
          .client-error-wrapper p {
            color: #6B6864;
          }
        `}</style>
      </div>
    );
  }

  const isPastDeadline = classData?.deadline && new Date() > classData.deadline.toDate();
  const isLocked = classData?.status === 'locked' || isPastDeadline;

  if (isLocked && classData) {
    return (
      <div className="client-locked-wrapper">
        <Lock size={48} className="lock-icon" />
        <h2>Link Blocat</h2>
        <p className="school-header">{classData.schoolName}</p>
        <p className="teacher-header">Diriginte: {classData.diriginteName}</p>
        <p className="lock-desc">
          {isPastDeadline ? (
            `Termenul limită pentru trimiterea opțiunilor (${classData.deadline.toDate().toLocaleDateString('ro-RO')}) a expirat. Datele au fost blocate automat.`
          ) : (
            'Termenul de trimitere sau modificare a opțiunilor pentru album a expirat. Datele au fost blocate de către fotograf pentru a începe procesul de design fizic.'
          )}
        </p>
        <style>{`
          .client-locked-wrapper {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background-color: #FAF9F6;
            color: #1F1E1C;
            padding: 40px 24px;
            text-align: center;
            max-width: 500px;
            margin: 0 auto;
          }
          .lock-icon {
            color: #8C765C;
            margin-bottom: 24px;
          }
          .client-locked-wrapper h2 {
            font-size: 26px;
            margin-bottom: 12px;
            font-weight: 500;
          }
          .school-header {
            font-size: 18px;
            font-weight: 500;
            margin-bottom: 4px;
          }
          .teacher-header {
            font-size: 14px;
            color: #6B6864;
            margin-bottom: 24px;
          }
          .lock-desc {
            font-size: 14px;
            line-height: 1.6;
            color: #9E9B96;
            border-top: 1px solid #E6E3DE;
            padding-top: 20px;
          }
        `}</style>
      </div>
    );
  }

  if (step === 'form' && classData) {
    return (
      <ConfiguratorForm
        classData={classData}
        studentName={selectedStudent}
        albumName={albumName}
        existingSubmission={existingSubmission}
        onBack={() => setStep('select')}
      />
    );
  }

  return (
    <div className="entry-wrapper">
      <div className="entry-card">
        <div className="entry-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <img src="/LOGO ALBUME.svg" alt="Alexia Graduation Albums Logo" style={{ maxWidth: '240px', width: '100%', height: 'auto', marginBottom: '12px' }} />
          <div className="class-info-box" style={{ width: '100%' }}>
            <h1>{classData?.schoolName}</h1>
            <p className="teacher">Diriginte: {classData?.diriginteName}</p>
          </div>
        </div>

        <div className="entry-body">
          <p className="instructions">
            Pentru a începe configurarea albumului tău de absolvire, te rugăm să introduci numele tău complet mai jos.
          </p>

          <div className="form-group">
            <label className="form-label">Selectează Numele Tău Complet</label>
            <div className="select-with-icon" style={{ position: 'relative' }}>
              <User size={18} className="select-icon" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#5f0b02', pointerEvents: 'none' }} />
              <select 
                value={selectedStudent} 
                onChange={(e) => setSelectedStudent(e.target.value)}
                className="form-select"
                style={{ width: '100%', padding: '12px 16px 12px 40px', backgroundColor: '#22201F', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '6px', outline: 'none', height: '48px', appearance: 'none', cursor: 'pointer' }}
                disabled={checkingSubmission}
              >
                <option value="">-- Alege din listă --</option>
                {classData?.studentList?.map(student => (
                  <option key={student} value={student}>{student}</option>
                ))}
              </select>
              <ChevronDown size={18} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#706E6A', pointerEvents: 'none' }} />
            </div>
            <p style={{ fontSize: '11px', color: '#9E9B96', marginTop: '6px' }}>
              Te rugăm să selectezi numele tău exact așa cum apare în catalogul clasei.
            </p>
          </div>

          {selectedStudent && (
            <div className="form-group" style={{ marginTop: '20px' }}>
              <label className="form-label">Completează numele dorit pe album (sau poreclă)</label>
              <input 
                type="text"
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                placeholder="Ex: Andrei, Popescu A. sau porecla dorită"
                className="form-input"
                style={{ width: '100%', padding: '12px 16px', backgroundColor: '#22201F', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '6px', outline: 'none', height: '48px' }}
                disabled={checkingSubmission}
              />
              <p style={{ fontSize: '11px', color: '#9E9B96', marginTop: '6px' }}>
                Acesta este numele sau porecla care va fi tipărită pe albumul tău.
              </p>
            </div>
          )}

          {checkingSubmission && (
            <div className="submission-check">
              <RefreshCw className="spinner inline-icon" size={14} />
              <span>Se verifică dacă există o configurare anterioară...</span>
            </div>
          )}

          {existingSubmission && !checkingSubmission && (
            <div className="existing-banner">
              <AlertCircle size={16} />
              <span>
                Ai trimis deja o configurare. Dacă continui, o vei putea modifica pe cea existentă.
              </span>
            </div>
          )}

          <button 
            onClick={handleStart}
            disabled={!selectedStudent || selectedStudent.trim().length < 3 || checkingSubmission}
            className="btn btn-start"
          >
            Configurează Album <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <style>{`
        .entry-wrapper {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: #1A1A1A;
          background-image: radial-gradient(circle at 50% 50%, #2d2d2d 0%, #1A1A1A 80%);
          padding: 24px;
          color: #F3EDE7;
        }

        .entry-card {
          width: 100%;
          max-width: 520px;
          background: rgba(22, 21, 20, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
          animation: fadeIn 0.4s ease;
        }

        .entry-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .logo-badge {
          display: inline-flex;
          padding: 12px;
          background: linear-gradient(135deg, #C5A880 0%, #9B7E5A 100%);
          border-radius: 50%;
          margin-bottom: 16px;
          box-shadow: 0 4px 15px rgba(197, 168, 128, 0.3);
        }

        .logo-icon {
          color: #121110;
        }

        .brand {
          font-size: 11px;
          color: #D8D0C8;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 24px;
          font-weight: 500;
        }

        .class-info-box h1 {
          font-family: var(--font-sans);
          font-size: 28px;
          font-weight: 600;
          line-height: 1.25;
          margin-bottom: 6px;
          color: #F3EDE7;
        }

        .teacher {
          font-size: 13px;
          color: #D8D0C8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .entry-body {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .instructions {
          font-size: 14px;
          color: #A3A09B;
          line-height: 1.6;
          text-align: center;
          margin-bottom: 12px;
        }

        .select-with-icon {
          position: relative;
          display: flex;
          align-items: center;
        }

        .select-icon {
          position: absolute;
          left: 14px;
          color: #9E9B96;
          pointer-events: none;
        }

        .form-select {
          width: 100%;
          padding: 12px 14px 12px 44px;
          background-color: #22201F;
          border: 1px solid #2D2A28;
          border-radius: 6px;
          color: #FAF9F6;
          font-family: inherit;
          font-size: 14px;
          height: 48px;
          appearance: none;
        }

        .btn-start {
          background-color: var(--gold-accent);
          color: #D8D0C8;
          height: 48px;
          font-weight: 600;
          letter-spacing: 0.05em;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin-top: 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .btn-start:hover {
          background-color: var(--gold-hover);
          transform: translateY(-1px);
        }

        .btn-start:disabled {
          background-color: #2D2A28;
          color: #5C5955;
          cursor: not-allowed;
          transform: none;
        }

        .existing-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background-color: rgba(197, 168, 128, 0.08);
          border: 1px solid rgba(197, 168, 128, 0.2);
          color: var(--gold-accent);
          padding: 12px;
          border-radius: 6px;
          font-size: 13px;
          line-height: 1.4;
        }

        .submission-check {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 12px;
          color: #A3A09B;
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        .inline-icon {
          vertical-align: middle;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
