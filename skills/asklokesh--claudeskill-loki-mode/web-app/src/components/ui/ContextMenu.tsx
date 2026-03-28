import { useState, useEffect, useRef, useCallback } from 'react';

interface ContextMenuItem {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  onClick: () => void;
  variant?: 'default' | 'danger';
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus first item on mount
  useEffect(() => {
    itemRefs.current[0]?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape, arrow key navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = (prev + 1) % items.length;
            itemRefs.current[next]?.focus();
            return next;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = (prev - 1 + items.length) % items.length;
            itemRefs.current[next]?.focus();
            return next;
          });
          break;
        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          itemRefs.current[0]?.focus();
          break;
        case 'End':
          e.preventDefault();
          setFocusedIndex(items.length - 1);
          itemRefs.current[items.length - 1]?.focus();
          break;
      }
    },
    [items.length, onClose]
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      className="bg-card border border-border rounded-card shadow-card-hover py-1 min-w-[160px]"
      style={{ position: 'fixed', left: x, top: y, zIndex: 100 }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const isDanger = item.variant === 'danger';
        return (
          <button
            key={item.label}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="menuitem"
            tabIndex={focusedIndex === index ? 0 : -1}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className={[
              'flex items-center gap-2 w-full text-left px-3 py-2 text-sm transition-colors',
              isDanger
                ? 'text-danger hover:bg-danger/10'
                : 'text-ink hover:bg-hover',
            ].join(' ')}
          >
            <Icon size={14} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export type { ContextMenuItem, ContextMenuProps };
