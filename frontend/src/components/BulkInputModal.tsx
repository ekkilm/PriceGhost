import { useState, useEffect } from 'react';

interface Option {
  value: string;
  label: string;
}

interface BulkInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  description?: string;
  type: 'number' | 'select';
  placeholder?: string;
  options?: Option[];
  count: number;
}

export default function BulkInputModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  type,
  placeholder,
  options,
  count,
}: BulkInputModalProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (isOpen) setValue('');
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!value) return;
    onConfirm(value);
  };

  return (
    <div className="bulk-modal-overlay" onClick={onClose}>
      <style>{`
        .bulk-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 1rem;
        }

        .bulk-modal {
          background: var(--surface);
          border-radius: 0.75rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          max-width: 400px;
          width: 100%;
          padding: 1.5rem;
        }

        .bulk-modal-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--text);
          margin: 0 0 0.25rem 0;
        }

        .bulk-modal-desc {
          font-size: 0.875rem;
          color: var(--text-muted);
          margin: 0 0 1rem 0;
        }

        .bulk-modal-count {
          font-size: 0.8125rem;
          color: var(--text-muted);
          margin-bottom: 1rem;
        }

        .bulk-modal input,
        .bulk-modal select {
          width: 100%;
          padding: 0.625rem 0.75rem;
          border: 1px solid var(--border);
          border-radius: 0.375rem;
          background: var(--background);
          color: var(--text);
          font-size: 0.9375rem;
        }

        .bulk-modal-actions {
          display: flex;
          gap: 0.5rem;
          justify-content: flex-end;
          margin-top: 1.25rem;
        }

        .bulk-modal-actions button {
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          font-size: 0.875rem;
          cursor: pointer;
          border: 1px solid var(--border);
          background: none;
          color: var(--text);
        }

        .bulk-modal-actions button.primary {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }

        .bulk-modal-actions button.primary:disabled {
          opacity: 0.5;
          cursor: default;
        }
      `}</style>

      <div className="bulk-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="bulk-modal-title">{title}</h3>
        {description && <p className="bulk-modal-desc">{description}</p>}
        <div className="bulk-modal-count">
          Applying to {count} product{count !== 1 ? 's' : ''}
        </div>

        {type === 'number' ? (
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            min="0"
            step="0.01"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        ) : (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          >
            <option value="">Select...</option>
            {options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}

        <div className="bulk-modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={handleSubmit} disabled={!value}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
