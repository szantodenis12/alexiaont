import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface AdminErrorBoundaryProps {
  children: ReactNode;
}

interface AdminErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class AdminErrorBoundary extends Component<AdminErrorBoundaryProps, AdminErrorBoundaryState> {
  constructor(props: AdminErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): AdminErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('AdminErrorBoundary caught an error', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="admin-wrapper" data-theme="dark" style={{ alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <div className="premium-card" style={{ maxWidth: '640px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <AlertCircle size={28} color="var(--error-color)" />
              <h2 style={{ margin: 0, color: 'var(--error-color)' }}>Eroare la redarea paginii</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Următoarea eroare a blocat componenta:
            </p>
            <pre style={{
              backgroundColor: 'var(--bg-color)',
              padding: '16px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              fontSize: '13px',
            }}>
              {this.state.error?.stack || this.state.error?.message}
            </pre>
            <button
              className="btn btn-gold"
              style={{ marginTop: '20px' }}
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/admin/dashboard'; }}
            >
              Mergi la Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
