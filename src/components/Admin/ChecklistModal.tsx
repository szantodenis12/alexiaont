import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, CheckSquare, Square, RefreshCw, Check } from 'lucide-react';

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt?: number;
}

interface ChecklistModalProps {
  title: string;
  subtitle?: string;
  items: ChecklistItem[];
  onSave: (updatedItems: ChecklistItem[]) => Promise<void>;
  onClose: () => void;
}

export const ChecklistModal: React.FC<ChecklistModalProps> = ({
  title,
  subtitle,
  items: initialItems,
  onSave,
  onClose,
}) => {
  const [items, setItems] = useState<ChecklistItem[]>(initialItems || []);
  const [newText, setNewText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  useEffect(() => {
    setItems(initialItems || []);
  }, [initialItems]);

  const handleAddItem = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newText.trim();
    if (!trimmed) return;

    const newItem: ChecklistItem = {
      id: Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7),
      text: trimmed,
      completed: false,
      createdAt: Date.now(),
    };

    const updated = [...items, newItem];
    setItems(updated);
    setNewText('');
    await persistChanges(updated);
  };

  const handleToggleItem = async (id: string) => {
    const updated = items.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    setItems(updated);
    await persistChanges(updated);
  };

  const handleDeleteItem = async (id: string) => {
    const updated = items.filter(item => item.id !== id);
    setItems(updated);
    await persistChanges(updated);
  };

  const handleStartEdit = (item: ChecklistItem) => {
    setEditingId(item.id);
    setEditingText(item.text);
  };

  const handleSaveEdit = async (id: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) {
      handleDeleteItem(id);
      return;
    }
    const updated = items.map(item =>
      item.id === id ? { ...item, text: trimmed } : item
    );
    setItems(updated);
    setEditingId(null);
    setEditingText('');
    await persistChanges(updated);
  };

  const persistChanges = async (updated: ChecklistItem[]) => {
    setIsSaving(true);
    try {
      await onSave(updated);
    } catch (err) {
      console.error('Error saving checklist:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const completedCount = items.filter(i => i.completed).length;
  const totalCount = items.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(9, 8, 8, 0.85)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#161514',
          border: '1px solid #262423',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '540px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #262423',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#11100F',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckSquare size={20} style={{ color: 'var(--gold-accent, #D4AF37)' }} />
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#FAF9F6' }}>
                Checklist
              </h3>
              {isSaving && (
                <span style={{ fontSize: '11px', color: '#706E6A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <RefreshCw className="spinner" size={12} /> Salvare...
                </span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#A3A09B' }}>
              {title} {subtitle ? `• ${subtitle}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#706E6A',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.2s',
            }}
            title="Închide"
          >
            <X size={20} />
          </button>
        </div>

        {/* Progress Bar Header */}
        {totalCount > 0 && (
          <div style={{ padding: '14px 24px 10px 24px', backgroundColor: '#131211', borderBottom: '1px solid #262423' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#A3A09B', marginBottom: '6px' }}>
              <span>Progres completare</span>
              <span style={{ fontWeight: 600, color: progressPct === 100 ? '#4CAF50' : 'var(--gold-accent, #D4AF37)' }}>
                {completedCount} din {totalCount} finalizate ({progressPct}%)
              </span>
            </div>
            <div style={{ width: '100%', height: '6px', backgroundColor: '#262423', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  backgroundColor: progressPct === 100 ? '#4CAF50' : 'var(--gold-accent, #D4AF37)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* Checklist Items Container */}
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: '#706E6A', fontSize: '13px' }}>
              Nu există niciun element în checklist. Adaugă primul task mai jos!
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  backgroundColor: item.completed ? '#11100F' : '#1A1918',
                  border: item.completed ? '1px solid #22201E' : '1px solid #2A2826',
                  borderRadius: '8px',
                  transition: 'all 0.15s ease',
                  opacity: item.completed ? 0.75 : 1,
                }}
              >
                {/* Checkbox Icon */}
                <button
                  onClick={() => handleToggleItem(item.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: item.completed ? 'var(--gold-accent, #D4AF37)' : '#706E6A',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                  title={item.completed ? 'Marchează nefinalizat' : 'Marchează finalizat'}
                >
                  {item.completed ? (
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--gold-accent, #D4AF37)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Check size={14} style={{ color: '#111' }} />
                    </div>
                  ) : (
                    <Square size={20} />
                  )}
                </button>

                {/* Item Text / Edit Mode */}
                {editingId === item.id ? (
                  <input
                    type="text"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={() => handleSaveEdit(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(item.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                    style={{
                      flex: 1,
                      backgroundColor: '#0E0D0C',
                      border: '1px solid var(--gold-accent, #D4AF37)',
                      borderRadius: '4px',
                      color: '#FAF9F6',
                      padding: '4px 8px',
                      fontSize: '14px',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <span
                    onClick={() => handleStartEdit(item)}
                    style={{
                      flex: 1,
                      fontSize: '14px',
                      color: item.completed ? '#706E6A' : '#FAF9F6',
                      textDecoration: item.completed ? 'line-through' : 'none',
                      cursor: 'pointer',
                      wordBreak: 'break-word',
                    }}
                    title="Click pentru a edita textul"
                  >
                    {item.text}
                  </span>
                )}

                {/* Delete Button */}
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#706E6A',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#E57373')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#706E6A')}
                  title="Șterge element"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add New Item Form Footer */}
        <form
          onSubmit={handleAddItem}
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #262423',
            backgroundColor: '#11100F',
            display: 'flex',
            gap: '10px',
          }}
        >
          <input
            type="text"
            placeholder="Adaugă un task nou (ex: Predat coperți, Trimis link)..."
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            style={{
              flex: 1,
              backgroundColor: '#1A1918',
              border: '1px solid #2A2826',
              borderRadius: '6px',
              padding: '10px 14px',
              color: '#FAF9F6',
              fontSize: '13px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!newText.trim()}
            style={{
              backgroundColor: 'var(--gold-accent, #D4AF37)',
              color: '#111',
              border: 'none',
              borderRadius: '6px',
              padding: '0 16px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: newText.trim() ? 'pointer' : 'not-allowed',
              opacity: newText.trim() ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Plus size={16} /> Adaugă
          </button>
        </form>
      </div>
    </div>
  );
};
