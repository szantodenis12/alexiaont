import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Play, Pause, RefreshCw, Volume2, AlertCircle } from 'lucide-react';

interface VoiceRecorderProps {
  onAudioRecorded: (blob: Blob | null, waveformPeaks?: number[]) => void;
  maxDurationSeconds?: number;
}

export const extractPCMDataFromBlob = async (blob: Blob, numSamples = 600): Promise<number[]> => {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);

    const blockSize = Math.floor(channelData.length / numSamples);
    const peaks: number[] = [];

    for (let i = 0; i < numSamples; i++) {
      const start = blockSize * i;
      let maxVal = 0;
      for (let j = 0; j < blockSize; j += 2) {
        const val = Math.abs(channelData[start + j] || 0);
        if (val > maxVal) maxVal = val;
      }
      peaks.push(maxVal);
    }

    const max = Math.max(...peaks) || 1;
    return peaks.map(val => Number((Math.max(0.02, val / max)).toFixed(4)));
  } catch (err) {
    console.error('Error extracting PCM waveform from blob:', err);
    return [];
  }
};

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onAudioRecorded,
  maxDurationSeconds = 60,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setError(null);
    audioChunksRef.current = [];
    setRecordingTime(0);

    try {
      // Ask for full-rate capture. Noise suppression and echo cancellation stay
      // on deliberately: students record wherever they happen to be, and without
      // them background noise comes through unfiltered. sampleRate is a hint —
      // browsers may ignore it — so it is safe to request.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        }
      });

      // Determine mime type supported by browser. Naming the Opus codec
      // explicitly avoids the browser falling back to a lower-quality default.
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('audio/webm')) {
          mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg';
        } else {
          mimeType = '';
        }
      }

      // Without an explicit bitrate the browser picks a low default for mono
      // voice (~40 kbps). At a one-minute limit, 128 kbps is under 1 MB.
      const options: MediaRecorderOptions = { audioBitsPerSecond: 128000 };
      if (mimeType) options.mimeType = mimeType;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Strip any ";codecs=..." suffix so the stored Content-Type stays the
        // plain container type, exactly as before this change.
        const blobType = (mimeType || 'audio/webm').split(';')[0];
        const finalBlob = new Blob(audioChunksRef.current, { type: blobType });
        setAudioBlob(finalBlob);
        const url = URL.createObjectURL(finalBlob);
        setAudioUrl(url);

        // Decode 100% REAL PCM waveform peaks directly from recorded microphone audio Blob
        const realPeaks = await extractPCMDataFromBlob(finalBlob, 600);
        onAudioRecorded(finalBlob, realPeaks);

        // Stop all tracks in stream to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(100); // Collect data chunks every 100ms
      setIsRecording(true);

      // Start live recording timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed >= maxDurationSeconds) {
          stopRecording();
        } else {
          setRecordingTime(elapsed);
        }
      }, 200);

    } catch (err: any) {
      console.error('Error accessing microphone:', err);
      setError('Nu am putut accesa microfonul. Te rugăm să permiți accesul la microfon în browser.');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleReset = () => {
    if (isPlaying && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    setPlaybackTime(0);
    onAudioRecorded(null);
  };

  const togglePlayback = () => {
    if (!audioPlayerRef.current || !audioUrl) return;
    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        backgroundColor: '#161514',
        border: '1px solid #262423',
        borderRadius: '12px',
        padding: '20px',
        maxWidth: '520px',
        width: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: isRecording ? 'rgba(224, 108, 117, 0.2)' : 'rgba(212, 175, 55, 0.12)',
              border: isRecording ? '1px solid #E06C75' : '1px solid rgba(212, 175, 55, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: isRecording ? '#E06C75' : 'var(--gold-accent, #D4AF37)',
            }}
          >
            <Mic size={18} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#FAF9F6' }}>
              Mesaj Vocal (Max. 1 minut)
            </h4>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#706E6A' }}>
              Înregistrează un mesaj scurt pentru albumul tău
            </p>
          </div>
        </div>

        {/* Live Timer badge */}
        <div
          style={{
            fontSize: '13px',
            fontWeight: 700,
            fontFamily: 'monospace',
            padding: '4px 10px',
            borderRadius: '6px',
            backgroundColor: isRecording ? 'rgba(224, 108, 117, 0.15)' : '#0E0D0C',
            color: isRecording ? '#E06C75' : '#FAF9F6',
            border: '1px solid #262423',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {isRecording && (
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#E06C75',
                animation: 'pulse 1s infinite',
              }}
            />
          )}
          {isRecording ? formatTime(recordingTime) : audioBlob ? formatTime(recordingTime) : `00:00 / 01:00`}
        </div>
      </div>

      {error && (
        <div style={{ backgroundColor: 'rgba(224,108,117,0.1)', border: '1px solid #E06C75', color: '#E06C75', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Audio Waveform / Progress Animation Box */}
      <div
        style={{
          height: '48px',
          backgroundColor: '#0E0D0C',
          borderRadius: '8px',
          border: '1px solid #262423',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 16px',
          overflow: 'hidden',
        }}
      >
        {isRecording ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '24px' }}>
            {[14, 24, 18, 28, 12, 22, 30, 16, 26, 20, 28, 14, 22, 18].map((h, i) => (
              <div
                key={i}
                style={{
                  width: '3px',
                  height: `${h}px`,
                  backgroundColor: '#E06C75',
                  borderRadius: '2px',
                  animation: `waveform 0.6s ease-in-out infinite alternate ${i * 0.05}s`,
                }}
              />
            ))}
          </div>
        ) : audioUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
            <button
              onClick={togglePlayback}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: 'var(--gold-accent, #D4AF37)',
                color: '#111',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {isPlaying ? <Pause size={14} fill="#111" /> : <Play size={14} fill="#111" style={{ marginLeft: '2px' }} />}
            </button>
            <div style={{ flex: 1, height: '4px', backgroundColor: '#262423', borderRadius: '2px', overflow: 'hidden' }}>
              <div
                style={{
                  width: audioPlayerRef.current?.duration ? `${(playbackTime / audioPlayerRef.current.duration) * 100}%` : '0%',
                  height: '100%',
                  backgroundColor: 'var(--gold-accent, #D4AF37)',
                }}
              />
            </div>
            <Volume2 size={16} style={{ color: '#706E6A' }} />
            <audio
              ref={audioPlayerRef}
              src={audioUrl}
              onTimeUpdate={() => {
                if (audioPlayerRef.current) {
                  setPlaybackTime(audioPlayerRef.current.currentTime);
                }
              }}
              onEnded={() => setIsPlaying(false)}
            />
          </div>
        ) : (
          <span style={{ fontSize: '12px', color: '#5C5A57' }}>
            Apasă pe butonul roșu de mai jos pentru a începe înregistrarea
          </span>
        )}
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: '10px' }}>
        {!audioBlob && !isRecording && (
          <button
            type="button"
            onClick={startRecording}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: '#5f0b02',
              color: '#FAF9F6',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Mic size={16} /> Pornește Înregistrarea
          </button>
        )}

        {isRecording && (
          <button
            type="button"
            onClick={stopRecording}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: '#E06C75',
              color: '#111',
              border: 'none',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Square size={16} fill="#111" /> Oprește Înregistrarea ({formatTime(recordingTime)})
          </button>
        )}

        {audioBlob && (
          <button
            type="button"
            onClick={handleReset}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: '#262423',
              color: '#FAF9F6',
              border: '1px solid #363432',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <RefreshCw size={14} /> Re-înregistrează Mesajul
          </button>
        )}
      </div>

      <style>{`
        @keyframes waveform {
          0% { height: 6px; }
          100% { height: 26px; }
        }
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.3; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};
