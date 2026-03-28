import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface SettingInputProps {
  label: string;
  description?: string;
  type?: 'text' | 'password' | 'number';
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SettingInput({
  label,
  description,
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
}: SettingInputProps) {
  const id = `input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && showPassword ? 'text' : type;

  return (
    <div className="py-3">
      <div className="mb-1.5">
        <label htmlFor={id} className="text-sm font-medium text-[#36342E]">
          {label}
        </label>
        {description && (
          <p className="text-xs text-[#6B6960] mt-0.5">{description}</p>
        )}
      </div>
      <div className="relative">
        <input
          id={id}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
          className={[
            'w-full px-3 py-2 text-sm border border-[#ECEAE3] rounded-lg bg-white text-[#36342E] focus:border-[#553DE9] focus:outline-none focus:ring-1 focus:ring-[#553DE9] placeholder:text-[#939084]',
            isPassword && 'pr-10',
            disabled ? 'opacity-50 cursor-not-allowed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#939084] hover:text-[#36342E] transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
