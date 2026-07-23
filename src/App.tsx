import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AdminLogin } from './components/Admin/AdminLogin';
import { AdminDashboard } from './components/Admin/AdminDashboard';
import { ClassCreator } from './components/Admin/ClassCreator';
import { PhotoGalleryCreator } from './components/Admin/PhotoGalleryCreator';
import { ConfiguratorEntry } from './components/Client/ConfiguratorEntry';
import { StandaloneGallery } from './components/Gallery/StandaloneGallery';
import { PhotoGalleryView } from './components/Gallery/PhotoGalleryView';
import { Camera, ChevronRight } from 'lucide-react';

export function LandingPage() {
  return (
    <div className="landing-wrapper">
      <header className="landing-nav container">
        <div className="landing-logo">
          <Camera size={24} className="logo-icon" />
          <span>Alexia Graduation Albums</span>
        </div>
        <Link to="/admin/login" className="btn btn-secondary btn-nav-login">
          Acces Fotograf
        </Link>
      </header>

      <main className="landing-hero container">
        <div className="hero-content animate-fade">
          <span className="badge-hero">Păstrează Amintirile Vii</span>
          <h1>Albume de absolvire,<br /><span className="serif-italic">perfect personalizate</span>.</h1>
          <p className="hero-description">
            Platformă profesională pentru vizualizarea galeriilor foto, selecția imaginilor pentru copertă, 
            pagini personale și adăugarea citatelor preferate direct în designul albumului tău de absolvire.
          </p>
          <div className="hero-buttons">
            <Link to="/admin/login" className="btn btn-gold">
              Panou Fotograf <ChevronRight size={16} />
            </Link>
            <a href="#cum-functioneaza" className="btn btn-secondary">
              Cum funcționează
            </a>
          </div>
        </div>
      </main>

      <section id="cum-functioneaza" className="landing-steps container">
        <div className="steps-header">
          <h2>Simplu. Rapid. Premium.</h2>
          <p>Procesul prin care albumul tău prinde viață</p>
        </div>

        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number">01</div>
            <h3>Creare & Încărcare</h3>
            <p>Fotograful încarcă galeria de poze a clasei și adaugă lista elevilor în panoul de control.</p>
          </div>
          <div className="step-card">
            <div className="step-number">02</div>
            <h3>Selecția Elevilor</h3>
            <p>Fiecare elev își alege poza de copertă, pozele cu colegii, fotografiile personale și adaugă citatul preferat.</p>
          </div>
          <div className="step-card">
            <div className="step-number">03</div>
            <h3>Procesare & Export</h3>
            <p>Sistemul convertește automat imaginile alb-negru la cerere, iar fotograful le poate descărca direct pentru print.</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="container footer-content">
          <p>© {new Date().getFullYear()} Alexia Graduation Albums. Toate drepturile rezervate.</p>
          <p className="footer-credits">Created for Professional School Photography</p>
        </div>
      </footer>

      <style>{`
        .landing-wrapper {
          min-height: 100vh;
          background-color: #FAF9F6;
          color: #1F1E1C;
          font-family: 'Outfit', sans-serif;
          display: flex;
          flex-direction: column;
        }

        .landing-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 90px;
        }

        .landing-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-sans);
          font-size: 22px;
          font-weight: 600;
          letter-spacing: 0.05em;
        }

        .logo-icon {
          color: #8C765C;
        }

        .btn-nav-login {
          border-radius: 20px;
          padding: 8px 20px;
          font-size: 12px;
        }

        .landing-hero {
          flex: 1;
          display: flex;
          align-items: center;
          padding-top: 60px;
          padding-bottom: 80px;
        }

        .hero-content {
          max-width: 650px;
        }

        .badge-hero {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: #8C765C;
          font-weight: 600;
          border: 1px solid rgba(140, 118, 92, 0.3);
          padding: 4px 12px;
          border-radius: 20px;
          display: inline-block;
          margin-bottom: 24px;
        }

        .hero-content h1 {
          font-size: 54px;
          font-weight: 400;
          line-height: 1.15;
          margin-bottom: 24px;
          letter-spacing: -0.01em;
        }

        @media (max-width: 600px) {
          .hero-content h1 {
            font-size: 40px;
          }
        }

        .hero-description {
          font-size: 16px;
          line-height: 1.7;
          color: #6B6864;
          margin-bottom: 40px;
        }

        .hero-buttons {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .landing-steps {
          background-color: #FFFFFF;
          border-top: 1px solid #E6E3DE;
          border-bottom: 1px solid #E6E3DE;
          padding-top: 100px;
          padding-bottom: 100px;
        }

        .steps-header {
          text-align: center;
          margin-bottom: 60px;
        }

        .steps-header h2 {
          font-size: 32px;
          font-weight: 400;
          margin-bottom: 8px;
        }

        .steps-header p {
          color: #6B6864;
          font-size: 15px;
        }

        .steps-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 40px;
        }

        @media (max-width: 768px) {
          .steps-grid {
            grid-template-columns: 1fr;
            gap: 32px;
          }
        }

        .step-card {
          padding: 24px;
          border: 1px solid #E6E3DE;
          border-radius: 8px;
          background-color: #FAF9F6;
          transition: all 0.3s;
        }

        .step-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.03);
          border-color: #8C765C;
        }

        .step-number {
          font-family: var(--font-sans);
          font-size: 36px;
          font-weight: 700;
          color: #8C765C;
          opacity: 0.8;
          margin-bottom: 16px;
        }

        .step-card h3 {
          font-family: 'Outfit', sans-serif;
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 10px;
        }

        .step-card p {
          font-size: 14px;
          color: #6B6864;
          line-height: 1.6;
        }

        .landing-footer {
          background-color: #FAF9F6;
          padding: 40px 0;
          border-top: 1px solid #E6E3DE;
          font-size: 13px;
          color: #9E9B96;
        }

        .footer-content {
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
        }

        .animate-fade {
          animation: fadeIn 0.8s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        {/* Admin routes */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/create-class" element={<ClassCreator />} />
        <Route path="/admin/create-photo-gallery" element={<PhotoGalleryCreator />} />
        <Route path="/admin/edit-photo-gallery/:galleryId" element={<PhotoGalleryCreator />} />

        {/* Client routes */}
        <Route path="/class/:classId" element={<ConfiguratorEntry />} />
        <Route path="/gallery/:classId" element={<StandaloneGallery />} />
        <Route path="/p-gallery/:galleryId" element={<PhotoGalleryView />} />

        {/* Redirect Root to Admin Dashboard */}
        <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </Router>
  );
}

export default App;

