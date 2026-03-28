interface SettingSliderProps {
  label: string;
  description?: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  unit?: string;
  disabled?: boolean;
}

export function SettingSlider({
  label,
  description,
  min,
  max,
  value,
  onChange,
  step = 1,
  unit = '',
  disabled = false,
}: SettingSliderProps) {
  const id = `slider-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-[#36342E]">
            {label}
          </label>
          {description && (
            <p className="text-xs text-[#6B6960] mt-0.5">{description}</p>
          )}
        </div>
        <span className="text-sm font-mono text-[#553DE9] min-w-[48px] text-right">
          {value}{unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="w-full h-2 rounded-full appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: `linear-gradient(to right, #553DE9 0%, #553DE9 ${pct}%, #ECEAE3 ${pct}%, #ECEAE3 100%)`,
        }}
      />
      <div className="flex justify-between mt-1">
        <span className="text-[11px] text-[#939084]">{min}{unit}</span>
        <span className="text-[11px] text-[#939084]">{max}{unit}</span>
      </div>
    </div>
  );
}
