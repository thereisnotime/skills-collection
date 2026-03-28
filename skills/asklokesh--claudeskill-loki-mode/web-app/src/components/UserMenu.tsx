import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Settings2,
  Keyboard,
  HelpCircle,
  LogOut,
  User,
  ChevronDown,
} from 'lucide-react';

interface UserMenuProps {
  user: {
    name: string;
    email: string;
    avatar_url?: string;
  } | null;
  isLocalMode: boolean;
  onLogout: () => void;
  onShowShortcuts?: () => void;
  onShowHelp?: () => void;
}

export function UserMenu({
  user,
  isLocalMode,
  onLogout,
  onShowShortcuts,
  onShowHelp,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const displayName = user?.name || user?.email || 'User';
  const initial = displayName[0]?.toUpperCase() || '?';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-btn hover:bg-hover transition-colors"
        aria-label="User menu"
        aria-expanded={open}
      >
        {user?.avatar_url ? (
          <img
            src={user.avatar_url}
            alt=""
            className="w-7 h-7 rounded-full flex-shrink-0 ring-2 ring-border"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ring-2 ring-border">
            {initial}
          </div>
        )}
        <ChevronDown
          size={12}
          className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-56 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50"
          style={{ animation: 'fadeIn 150ms ease-out' }}
        >
          {/* User info header */}
          <div className="px-4 py-3 border-b border-border bg-hover/30">
            <div className="flex items-center gap-3">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="w-9 h-9 rounded-full flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {initial}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">
                  {isLocalMode ? 'Local Mode' : displayName}
                </p>
                {user?.email && !isLocalMode && (
                  <p className="text-xs text-muted truncate">{user.email}</p>
                )}
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <NavLink
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-xs text-ink hover:bg-hover transition-colors"
            >
              <User size={14} className="text-muted" />
              Profile
            </NavLink>
            <NavLink
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-xs text-ink hover:bg-hover transition-colors"
            >
              <Settings2 size={14} className="text-muted" />
              Settings
            </NavLink>

            <div className="border-t border-border my-1" />

            {onShowShortcuts && (
              <button
                onClick={() => {
                  setOpen(false);
                  onShowShortcuts();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-ink hover:bg-hover transition-colors text-left"
              >
                <Keyboard size={14} className="text-muted" />
                Keyboard Shortcuts
                <kbd className="ml-auto text-[10px] text-muted bg-hover px-1.5 py-0.5 rounded border border-border font-mono">
                  ?
                </kbd>
              </button>
            )}
            {onShowHelp && (
              <button
                onClick={() => {
                  setOpen(false);
                  onShowHelp();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-ink hover:bg-hover transition-colors text-left"
              >
                <HelpCircle size={14} className="text-muted" />
                Help & Docs
              </button>
            )}

            {!isLocalMode && (
              <>
                <div className="border-t border-border my-1" />
                <button
                  onClick={() => {
                    setOpen(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-red-500 hover:bg-hover transition-colors text-left"
                >
                  <LogOut size={14} />
                  Sign Out
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
