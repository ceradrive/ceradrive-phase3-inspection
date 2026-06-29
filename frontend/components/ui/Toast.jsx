'use client';

/**
 * CERADRIVE ERP — Toast Notification System
 * Theme V1: dark pill, bottom-right, auto-dismiss 2.5s.
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextToastId = useRef(1);

  const addToast = useCallback((title, subtitle = '') => {
    const id = `${Date.now()}-${nextToastId.current++}`;
    setToasts(prev => [...prev, { id, title, subtitle }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {/* Toast container — bottom right */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <div key={t.id} className="toast-item">
            {/* Green check circle */}
            <div style={{
              width: 18, height: 18, borderRadius: '50%',
              background: '#059669',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, marginTop: 1,
            }}>
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.title}</div>
              {t.subtitle && (
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{t.subtitle}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
