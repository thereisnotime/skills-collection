interface SkeletonProps {
  variant?: 'text' | 'block' | 'circle';
  width?: string;
  height?: string;
  className?: string;
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
}: SkeletonProps) {
  const base = 'animate-pulse bg-[#ECEAE3]/60 rounded';

  if (variant === 'circle') {
    const size = width || '2rem';
    return (
      <div
        className={`${base} rounded-full flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  if (variant === 'block') {
    return (
      <div
        className={`${base} rounded-btn ${className}`}
        style={{ width: width || '100%', height: height || '4rem' }}
      />
    );
  }

  // text variant
  return (
    <div
      className={`${base} rounded-btn ${className}`}
      style={{ width: width || '100%', height: height || '0.75rem' }}
    />
  );
}

export function SkeletonFileTree() {
  return (
    <div className="p-2 space-y-2">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2">
          <Skeleton variant="block" width="14px" height="14px" />
          <Skeleton variant="text" width={`${50 + Math.random() * 40}%`} height="10px" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonEditor() {
  return (
    <div className="p-4 space-y-3">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton variant="text" width="1.5rem" height="10px" className="flex-shrink-0 opacity-40" />
          <Skeleton variant="text" width={`${20 + Math.random() * 60}%`} height="10px" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonActivityPanel() {
  return (
    <div className="p-3 space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton variant="circle" width="1.25rem" />
          <div className="flex-1 space-y-1.5">
            <Skeleton variant="text" width={`${40 + Math.random() * 40}%`} height="10px" />
            <Skeleton variant="text" width={`${30 + Math.random() * 20}%`} height="8px" className="opacity-50" />
          </div>
        </div>
      ))}
    </div>
  );
}
