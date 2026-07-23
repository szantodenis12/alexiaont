import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';

export const AdminLogin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already logged in
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        navigate('/admin/dashboard');
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Te rugăm să completezi toate câmpurile.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/admin/dashboard');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('E-mail sau parolă incorectă.');
      } else {
        setError('A apărut o eroare la autentificare. Încearcă din nou.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper" data-theme="dark">
      <div className="login-card">
        <div className="login-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <img src="/LOGO ALBUME.svg" alt="Alexia Graduation Albums Logo" style={{ maxWidth: '280px', width: '100%', height: 'auto', marginBottom: '8px' }} />
          <p className="subtitle" style={{ margin: 0 }}>Admin Panel</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="form-group-login">
            <label className="form-label-login">E-mail</label>
            <div className="input-with-icon">
              <Mail size={18} className="input-icon" />
              <input
                type="email"
                placeholder="nume@exemplu.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="login-input"
              />
            </div>
          </div>

          <div className="form-group-login">
            <label className="form-label-login">Parolă</label>
            <div className="input-with-icon">
              <Lock size={18} className="input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="login-input"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-login">
            {loading ? 'Se conectează...' : 'Autentificare'}
          </button>
        </form>
      </div>

      <style>{`
        .login-wrapper {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: #0E0D0C;
          background-image: radial-gradient(circle at 50% 50%, #201D1A 0%, #0E0D0C 80%);
          padding: 20px;
          color: #F5F4F0;
        }

        .login-card {
          width: 100%;
          max-width: 420px;
          background: rgba(22, 21, 20, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
        }

        .login-header {
          text-align: center;
          margin-bottom: 36px;
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

        .login-header h1 {
          font-family: var(--font-sans);
          font-size: 28px;
          font-weight: 600;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
          color: #FAF9F6;
        }

        .subtitle {
          font-size: 13px;
          color: #A3A09B;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .form-group-login {
          margin-bottom: 24px;
        }

        .form-label-login {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
          margin-bottom: 8px;
          color: #A3A09B;
        }

        .input-with-icon {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 14px;
          color: #706E6A;
          pointer-events: none;
        }

        .login-input {
          width: 100%;
          padding: 14px 16px 14px 44px;
          background-color: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          color: #F5F4F0;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          outline: none;
          font-size: 14px;
        }

        .login-input:focus {
          border-color: var(--gold-accent);
          box-shadow: 0 0 0 2px rgba(95, 11, 2, 0.2);
        }

        .password-toggle {
          position: absolute;
          right: 14px;
          background: none;
          border: none;
          color: #706E6A;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s ease;
        }

        .password-toggle:hover {
          color: var(--gold-accent);
        }

        .login-error {
          background-color: rgba(224, 108, 117, 0.15);
          border: 1px solid rgba(224, 108, 117, 0.3);
          color: #E06C75;
          padding: 12px;
          border-radius: 6px;
          font-size: 13px;
          margin-bottom: 24px;
          text-align: center;
        }

        .btn-login {
          width: 100%;
          padding: 14px;
          background-color: var(--gold-accent);
          color: #D8D0C8;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
        }

        .btn-login:hover {
          background-color: var(--gold-hover);
          transform: translateY(-1px);
        }

        .btn-login:active {
          transform: translateY(1px);
        }

        .btn-login:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
      `}</style>
    </div>
  );
};
