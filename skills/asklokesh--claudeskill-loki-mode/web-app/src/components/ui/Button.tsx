import { forwardRef } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ComponentType<{ size?: number }>;
  iconRight?: React.ComponentType<{ size?: number }>;
  loading?: boolean;
}

const variantClasses: Record<string, string> = {
  primary:
    'bg-[#553DE9] text-white hover:bg-[#4432c4] shadow-button rounded-btn',
  secondary:
    'border border-[#553DE9] text-[#553DE9] hover:bg-[#E8E4FD] bg-transparent rounded-btn',
  ghost: 'text-[#36342E] hover:bg-[#F8F4F0] rounded-btn',
  danger:
    'bg-[#C45B5B]/10 text-[#C45B5B] border border-[#C45B5B]/20 hover:bg-[#C45B5B]/20 rounded-btn',
};

const sizeClasses: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

const iconSizes: Record<string, number> = {
  sm: 14,
  md: 16,
  lg: 18,
};

function Spinner({ size }: { size: number }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      icon: Icon,
      iconRight: IconRight,
      loading = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const iSize = iconSizes[size];

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          'inline-flex items-center justify-center gap-2 font-medium transition-colors',
          variantClasses[variant],
          sizeClasses[size],
          (disabled || loading) && 'opacity-60 cursor-not-allowed',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        {loading ? (
          <Spinner size={iSize} />
        ) : Icon ? (
          <Icon size={iSize} />
        ) : null}
        {children}
        {IconRight && !loading && <IconRight size={iSize} />}
      </button>
    );
  }
);

Button.displayName = 'Button';
