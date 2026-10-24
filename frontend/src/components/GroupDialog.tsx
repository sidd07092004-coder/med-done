import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Group } from '../api/types';

/** Languages that can carry a localized group name (English is the base name). */
const TRANSLATION_LANGS = [
  { key: 'hr', label: 'Croatian (hr)' },
  { key: 'tr', label: 'Turkish (tr)' },
  { key: 'ar', label: 'Arabic (ar)' },
] as const;

export interface GroupFormValues {
  name: string;
  name_translations: Record<string, string>;
}

interface GroupDialogProps {
  mode: 'create' | 'edit';
  /** Parent group when creating a subgroup (create mode only). */
  parent?: Group | null;
  /** Group being edited (edit mode only). */
  group?: Group | null;
  pending: boolean;
  /** Server-side error shown inside the dialog. */
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: GroupFormValues) => void;
}

export function GroupDialog({
  mode,
  parent,
  group,
  pending,
  error,
  onClose,
  onSubmit,
}: GroupDialogProps) {
  const titleId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(group?.name ?? '');
  const [translations, setTranslations] = useState<Record<string, string>>({
    hr: group?.name_translations?.hr ?? '',
    tr: group?.name_translations?.tr ?? '',
    ar: group?.name_translations?.ar ?? '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, onClose]);

  const title =
    mode === 'create'
      ? parent
        ? `New subgroup under “${parent.name}”`
        : 'New top-level group'
      : `Edit group “${group?.name ?? ''}”`;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError('English name is required.');
      nameInputRef.current?.focus();
      return;
    }

    // Only include non-empty translations. An empty object clears them all.
    const nameTranslations: Record<string, string> = {};
    for (const lang of TRANSLATION_LANGS) {
      const value = translations[lang.key]?.trim();
      if (value) nameTranslations[lang.key] = value;
    }

    setValidationError(null);
    onSubmit({ name: trimmedName, name_translations: nameTranslations });
  };

  const message = validationError ?? error;

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!pending) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{title}</h3>
        <form onSubmit={submit} noValidate>
          {message && (
            <div className="alert alert-error" role="alert">
              {message}
            </div>
          )}

          <label className="field">
            <span>English name</span>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <div className="translation-group">
            <span className="translation-label">Translations (optional)</span>
            <div className="translation-grid">
              {TRANSLATION_LANGS.map((lang) => (
                <label className="field" key={lang.key}>
                  <span>{lang.label}</span>
                  <input
                    type="text"
                    value={translations[lang.key] ?? ''}
                    onChange={(e) =>
                      setTranslations((prev) => ({ ...prev, [lang.key]: e.target.value }))
                    }
                    dir={lang.key === 'ar' ? 'rtl' : undefined}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
