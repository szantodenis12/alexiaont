import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Play, Pause, Mic, AlertCircle, RefreshCw } from 'lucide-react';

export const VoiceMessagePlayer: React.FC = () => {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [submission, setSubmission] = useState<any | null>(null);
  const [classInfo, setClassInfo] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const fetchVoiceData = async () => {
      if (!submissionId) {
        setError('Cod mesaj invalid.');
        setLoading(false);
        return;
      }

      try {
        const subSnap = await getDoc(doc(db, 'submissions', submissionId));
        if (!subSnap.exists()) {
          setError('Mesajul vocal nu a fost găsit.');
          setLoading(false);
          return;
        }

        const subData = subSnap.data();
        setSubmission(subData);

        if (subData.classId) {
          const classSnap = await getDoc(doc(db, 'classes', subData.classId));
          if (classSnap.exists()) {
            setClassInfo(classSnap.data());
          }
        }
      } catch (err: any) {
        console.error('Error loading voice message:', err);
        setError('A apărut o eroare la încărcarea mesajului vocal.');
      } finally {
        setLoading(false);
      }
    };

    fetchVoiceData();
  }, [submissionId]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(err => console.error(err));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit, sans-serif' }}>
        <div style={{ textAlign: 'center', color: '#706E6A' }}>
          <RefreshCw className="spinner" size={36} style={{ color: 'var(--gold-accent, #D4AF37)', marginBottom: '16px' }} />
          <p style={{ color: '#FAF9F6', fontSize: '14px' }}>Se încarcă mesajul vocal...</p>
        </div>
      </div>
    );
  }

  if (error || !submission || !submission.voiceMessageUrl) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0C0B0A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit, sans-serif', padding: '20px' }}>
        <div style={{ textAlign: 'center', maxWidth: '420px', backgroundColor: '#161514', border: '1px solid #262423', borderRadius: '16px', padding: '40px 24px', boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
          <AlertCircle size={48} style={{ color: '#E06C75', margin: '0 auto 16px', display: 'block' }} />
          <h2 style={{ color: '#FAF9F6', fontSize: '20px', margin: '0 0 8px' }}>Mesaj Negăsit</h2>
          <p style={{ color: '#706E6A', fontSize: '14px', lineHeight: 1.6, margin: '0 0 24px' }}>
            {error || 'Acest mesaj vocal nu există sau a fost șters.'}
          </p>
        </div>
      </div>
    );
  }

  const studentName = submission.albumName || submission.studentName || 'Absolvent';
  const schoolName = classInfo?.schoolName || 'Album Absolvenți';

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0C0B0A',
        fontFamily: 'Outfit, sans-serif',
        color: '#FAF9F6',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: '460px',
          width: '100%',
          backgroundColor: '#161514',
          border: '1px solid #262423',
          borderRadius: '20px',
          padding: '36px 28px',
          boxShadow: '0 30px 60px rgba(0, 0, 0, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Top Gold Accent Badge */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', backgroundColor: 'var(--gold-accent, #D4AF37)' }} />

        {/* Header Icon */}
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: 'rgba(212, 175, 55, 0.12)',
            border: '1px solid rgba(212, 175, 55, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--gold-accent, #D4AF37)',
            marginBottom: '20px',
          }}
        >
          <Mic size={28} />
        </div>

        <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#706E6A', fontWeight: 600, marginBottom: '6px' }}>
          Mesaj Vocal Absolvent
        </span>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#FAF9F6', margin: '0 0 6px', wordBreak: 'break-word' }}>
          {studentName}
        </h1>
        <p style={{ fontSize: '13px', color: '#A3A09B', margin: '0 0 28px' }}>
          {schoolName}
        </p>

        {/* Animated Soundwave Visualizer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            height: '44px',
            marginBottom: '28px',
            width: '100%',
          }}
        >
          {[16, 32, 20, 40, 24, 36, 18, 44, 28, 38, 20, 32, 16, 28, 36, 22, 18].map((h, i) => (
            <div
              key={i}
              style={{
                width: '4px',
                height: isPlaying ? `${h}px` : '10px',
                backgroundColor: isPlaying ? 'var(--gold-accent, #D4AF37)' : '#363432',
                borderRadius: '2px',
                transition: 'all 0.2s ease',
                animation: isPlaying ? `wave 0.7s ease-in-out infinite alternate ${i * 0.04}s` : 'none',
              }}
            />
          ))}
        </div>

        {/* Big Play / Pause Button */}
        <button
          onClick={togglePlay}
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            backgroundColor: 'var(--gold-accent, #D4AF37)',
            color: '#111',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 10px 30px rgba(212, 175, 55, 0.3)',
            transition: 'transform 0.2s, background-color 0.2s',
            marginBottom: '24px',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.95)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {isPlaying ? <Pause size={30} fill="#111" /> : <Play size={30} fill="#111" style={{ marginLeft: '4px' }} />}
        </button>

        {/* Seek Bar & Timers */}
        <div style={{ width: '100%', marginBottom: '24px' }}>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            style={{
              width: '100%',
              accentColor: 'var(--gold-accent, #D4AF37)',
              cursor: 'pointer',
              height: '6px',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#706E6A', marginTop: '6px', fontFamily: 'monospace' }}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Native Audio element */}
        <audio
          ref={audioPlayerRef => {
            audioRef.current = audioPlayerRef;
          }}
          src={submission.voiceMessageUrl}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              setDuration(audioRef.current.duration);
            }
          }}
          onTimeUpdate={() => {
            if (audioRef.current) {
              setCurrentTime(audioRef.current.currentTime);
            }
          }}
          onEnded={() => setIsPlaying(false)}
        />

        {/* Footer Brand Credit */}
        <div style={{ borderTop: '1px solid #262423', paddingTop: '20px', width: '100%' }}>
          <span style={{ fontSize: '10px', color: '#5C5A57', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 600 }}>
            ALEXIA VISUAL ARTIST • ALBUM DE ABSOLVIRE
          </span>
        </div>
      </div>

      <style>{`
        @keyframes wave {
          0% { height: 10px; }
          100% { height: 42px; }
        }
      `}</style>
    </div>
  );
};
