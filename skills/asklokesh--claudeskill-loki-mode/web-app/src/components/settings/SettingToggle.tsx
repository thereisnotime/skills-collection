interface SettingToggleProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SettingToggle({
  label,
  description,
  value,
  onChange,
  disabled = false,
}: SettingToggleProps) {
  const id = `toggle-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 mr-4">
        <label htmlFor={id} className="text-sm font-medium text-[#36342E] cursor-pointer">
          {label}
        </label>
        {description && (
          <p className="text-xs text-[#6B6960] mt-0.5">{description}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={[
          'relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#553DE9]',
          value ? 'bg-[#553DE9]' : 'bg-[#ECEAE3]',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200',
            value ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  );
}
