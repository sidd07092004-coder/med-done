import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMedia } from '../api/client';
import type { MediaFile } from '../api/types';
import { formatBytes } from '../lib/format';

export type MediaAccept = 'image' | 'document' | 'audio' | 'video' | 'vtt' | 'all';

interface MediaPickerProps {
  /** Called with the chosen public URL (or a manually entered one). */
  onSelect: (url: string) => void;
  onClose: () => void;
  /** Optional type filter. Defaults to images to preserve the original picker. */
  accept?: MediaAccept;
}

const ACCEPT_TITLES: Record<MediaAccept, string> = {
  image: 'Choose an image',
  document: 'Choose a document',
  audio: 'Choose audio',
  video: 'Choose a video',
  vtt: 'Choose a captions file',
  all: 'Choose a file',
};

const MANUAL_LABELS: Record<MediaAccept, string> = {
  image: 'Or paste an image URL',
  document: 'Or paste a document URL',
  audio: 'Or paste an audio URL',
  video: 'Or paste a video URL',
  vtt: 'Or paste a .vtt URL',
  all: 'Or paste a file URL',
};

const EMPTY_MESSAGES: Record<MediaAccept, string> = {
  image: 'No images uploaded yet. Upload one in the Media library, or paste a URL above.',
  document: 'No documents uploaded yet. Upload one in the Media library, or paste a URL above.',
  audio: 'No audio files uploaded yet. Upload one in the Media library, or paste a URL above.',
  video: 'No videos uploaded yet. Upload one in the Media library, or paste a URL above.',
  vtt: 'No .vtt files uploaded yet. Upload one in the Media library, or paste a URL above.',
  all: 'No files uploaded yet. Upload one in the Media library, or paste a URL above.',
};

function extension(filename: string): string {
  const clean = filename.split('?')[0] ?? '';
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function isImage(file: MediaFile): boolean {
  return file.content_type.toLowerCase().startsWith('image/');
}

function matchesAccept(file: MediaFile, accept: MediaAccept): boolean {
  if (accept === 'all') return true;

  const type = file.content_type.toLowerCase();
  const ext = extension(file.filename);

  switch (accept) {
    case 'image':
      return (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) &&
        ext !== 'svg';
    case 'document':
      return type === 'application/pdf' || ['pdf', 'docx'].includes(ext);
    case 'audio':
      return type.startsWith('audio/') || ['mp3', 'm4a', 'ogg', 'wav'].includes(ext);
    case 'video':
      return type.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext);
    case 'vtt':
      return type === 'text/vtt' || ext === 'vtt';
    default:
      return true;
  }
}

function fileBadge(file: MediaFile): string {
  const ext = extension(file.filename);
  return ext ? ext.toUpperCase().slice(0, 5) : 'FILE';
}

/**
 * Modal media chooser used by image/media fields. Renders an image thumbnail
 * for pictures and a file-type badge for everything else.
 */
export function MediaPicker({ onSelect, onClose, accept = 'image' }: MediaPickerProps) {
  const mediaQuery = useQuery({ queryKey: ['media'], queryFn: fetchMedia, staleTime: 10_000 });
  const [manual, setManual] = useState('');

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const url = manual.trim();
    if (url) onSelect(url);
  };

  const files = (mediaQuery.data ?? []).filter((file) => matchesAccept(file, accept));

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="media-picker-title">{ACCEPT_TITLES[accept]}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form className="picker-manual" onSubmit={submitManual}>
          <label className="field compact" style={{ flex: 1 }}>
            <span>{MANUAL_LABELS[accept]}</span>
            <input
              type="text"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="/uploads/example"
            />
          </label>
          <button type="submit" className="btn" disabled={!manual.trim()}>
            Use URL
          </button>
        </form>

        {mediaQuery.isLoading && <p className="muted small">Loading media…</p>}
        {mediaQuery.isError && (
          <div className="alert alert-error" role="alert">
            Could not load media: {(mediaQuery.error as Error).message}
          </div>
        )}

        {mediaQuery.isSuccess && files.length === 0 && (
          <p className="muted">{EMPTY_MESSAGES[accept]}</p>
        )}

        {files.length > 0 && (
          <ul className="media-grid picker-grid">
            {files.map((file) => (
              <li key={file.id}>
                <button
                  type="button"
                  className="media-item pickable"
                  onClick={() => file.public_url && onSelect(file.public_url)}
                  disabled={!file.public_url}
                  title={file.filename}
                >
                  <span className="media-thumb">
                    {isImage(file) && file.public_url ? (
                      <img src={file.public_url} alt={file.filename} loading="lazy" />
                    ) : (
                      <span className="media-type-badge">{fileBadge(file)}</span>
                    )}
                  </span>
                  <span className="media-name">{file.filename}</span>
                  <span className="media-meta">{formatBytes(file.size_bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
