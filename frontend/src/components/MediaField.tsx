import { useState } from 'react';
import { MediaPicker } from './MediaPicker';
import type { MediaAccept } from './MediaPicker';

interface MediaFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  accept?: MediaAccept;
  disabled?: boolean;
  placeholder?: string;
}

const PLACEHOLDERS: Record<MediaAccept, string> = {
  image: '/uploads/example.jpg',
  document: '/uploads/document.pdf',
  audio: '/uploads/audio.mp3',
  video: '/uploads/video.mp4',
  vtt: '/uploads/captions.vtt',
  all: '/uploads/file',
};

export function MediaField({
  value,
  onChange,
  label = 'Media',
  accept = 'all',
  disabled = false,
  placeholder,
}: MediaFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="field media-field">
      <span>{label}</span>

      <div className="media-field-row">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder ?? PLACEHOLDERS[accept]}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn small"
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          Choose from library
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => onChange('')}
          disabled={disabled || value.length === 0}
        >
          Clear
        </button>
      </div>

      {value && (
        <div className="media-field-preview">
          {accept === 'image' && <img src={value} alt="" />}
          {accept === 'audio' && <audio controls src={value} preload="metadata" />}
          {accept === 'video' && <video controls src={value} preload="metadata" />}
          {accept === 'document' && (
            <a href={value} target="_blank" rel="noopener noreferrer">
              Open selected document
            </a>
          )}
        </div>
      )}

      {open && (
        <MediaPicker
          accept={accept}
          onSelect={(url) => {
            onChange(url);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
