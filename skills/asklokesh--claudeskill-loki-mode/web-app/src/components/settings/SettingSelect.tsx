interface SelectOption {
  value: string;
  label: string;
}

interface SettingSelectProps {
  label: string;
  description?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SettingSelect({
  label,
  description,
  options,
  value,
  onChange,
  disabled = false,
}: SettingSelectProps) {
  const id = `select-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 mr-4">
        <label htmlFor={id} className="text-sm font-medium text-[#36342E]">
          {label}
        </label>
        {description && (
          <p className="text-xs text-[#6B6960] mt-0.5">{description}</p>
        )}
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className={[
          'px-3 py-1.5 text-sm border border-[#ECEAE3] rounded-lg bg-white text-[#36342E] focus:border-[#553DE9] focus:outline-none focus:ring-1 focus:ring-[#553DE9] min-w-[140px]',
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
