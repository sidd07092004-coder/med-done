import {
  FaAlignCenter,
  FaAlignJustify,
  FaAlignLeft,
  FaAlignRight,
} from 'react-icons/fa';
import type { IconType } from 'react-icons';
import type { ContentAlignment } from '../api/types';

interface AlignmentToolbarProps {
  value?: ContentAlignment;
  onChange: (alignment: ContentAlignment) => void;
  disabled?: boolean;
  allowJustify?: boolean;
}

const OPTIONS: {
  value: ContentAlignment;
  label: string;
  Icon: IconType;
}[] = [
  { value: 'left', label: 'Align left', Icon: FaAlignLeft },
  { value: 'center', label: 'Align center', Icon: FaAlignCenter },
  { value: 'right', label: 'Align right', Icon: FaAlignRight },
  { value: 'justify', label: 'Justify text', Icon: FaAlignJustify },
];

export function AlignmentToolbar({
  value = 'left',
  onChange,
  disabled = false,
  allowJustify = true,
}: AlignmentToolbarProps) {
  const options = allowJustify
    ? OPTIONS
    : OPTIONS.filter((option) => option.value !== 'justify');

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-slate-50 p-1 shadow-sm"
      role="group"
      aria-label="Content alignment"
    >
      {options.map(({ value: alignment, label, Icon }) => {
        const selected = value === alignment;

        return (
          <button
            key={alignment}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(alignment)}
            className={`flex h-9 w-9 items-center justify-center rounded-md border transition-all duration-200
                ${
                    selected
                    ? 'border-indigo-700 bg-indigo-600 text-white shadow-sm'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700'
                }
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Icon size={18} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
