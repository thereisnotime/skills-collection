interface IconButtonProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'subtle';
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}

const variantClasses: Record<string, string> = {
  ghost: 'hover:bg-[#F8F4F0] text-[#36342E]',
  subtle: 'hover:bg-[#ECEAE3] text-[#6B6960]',
};

const sizeClasses: Record<string, string> = {
  sm: 'w-7 h-7',
  md: 'w-8 h-8',
};

const iconSizes: Record<string, number> = {
  sm: 14,
  md: 16,
};

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  variant = 'ghost',
  onClick,
  className = '',
  disabled = false,
  title,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center rounded-btn transition-colors',
        variantClasses[variant],
        sizeClasses[size],
        disabled ? 'opacity-40 cursor-not-allowed' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Icon size={iconSizes[size]} />
    </button>
  );
}
