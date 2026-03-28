import { useRef, useState, useEffect } from 'react';
import { Button } from './ui/Button';
import {
  ChevronLeft, ChevronRight, Award, Rocket, Clock, BarChart3,
  Users, Star,
} from 'lucide-react';
import type { TemplateMetadata } from '../types/api';

// Placeholder stats for featured templates
const FEATURED_STATS: Record<string, { uses: number; rating: number; avgTime: string }> = {
  'saas-starter.md': { uses: 2847, rating: 4.9, avgTime: '12 min' },
  'rest-api-auth.md': { uses: 1923, rating: 4.8, avgTime: '8 min' },
  'discord-bot.md': { uses: 1654, rating: 4.7, avgTime: '6 min' },
  'full-stack-demo.md': { uses: 1432, rating: 4.8, avgTime: '15 min' },
  'data-pipeline.md': { uses: 1198, rating: 4.6, avgTime: '10 min' },
  'cli-tool.md': { uses: 987, rating: 4.7, avgTime: '7 min' },
  'e-commerce.md': { uses: 2156, rating: 4.8, avgTime: '18 min' },
  'blog-platform.md': { uses: 1345, rating: 4.5, avgTime: '11 min' },
};

// Category-specific gradients for featured cards
const CATEGORY_FEATURED_GRADIENT: Record<string, string> = {
  Website: 'from-violet-600 via-purple-500 to-indigo-500',
  API: 'from-teal-600 via-emerald-500 to-cyan-500',
  CLI: 'from-slate-600 via-gray-500 to-blue-500',
  Bot: 'from-orange-500 via-rose-500 to-pink-500',
  Data: 'from-blue-600 via-indigo-500 to-purple-500',
  Other: 'from-gray-500 via-slate-500 to-zinc-500',
};

const TECH_COLORS: Record<string, string> = {
  React: 'bg-sky-500/15 text-sky-600',
  'Node.js': 'bg-green-500/15 text-green-600',
  Python: 'bg-yellow-500/15 text-yellow-700',
  TypeScript: 'bg-blue-500/15 text-blue-600',
  PostgreSQL: 'bg-indigo-500/15 text-indigo-600',
  MongoDB: 'bg-green-600/15 text-green-700',
  Docker: 'bg-cyan-500/15 text-cyan-600',
  Redis: 'bg-red-500/15 text-red-600',
  Express: 'bg-gray-500/15 text-gray-600',
  FastAPI: 'bg-teal-500/15 text-teal-600',
  SQLite: 'bg-blue-400/15 text-blue-500',
  Tailwind: 'bg-cyan-400/15 text-cyan-600',
  Discord: 'bg-indigo-400/15 text-indigo-500',
  Slack: 'bg-purple-500/15 text-purple-600',
  CLI: 'bg-amber-500/15 text-amber-600',
  Playwright: 'bg-green-500/15 text-green-600',
  Vite: 'bg-purple-400/15 text-purple-500',
  Next: 'bg-gray-600/15 text-gray-700',
};

interface FeaturedTemplatesProps {
  templates: TemplateMetadata[];
  onSelect: (filename: string) => void;
  onPreview: (template: TemplateMetadata) => void;
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatTemplateName(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FeaturedTemplates({ templates, onSelect, onPreview }: FeaturedTemplatesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Pick featured templates (ones with stats, or top N)
  const featured = templates
    .filter(t => t.filename in FEATURED_STATS)
    .slice(0, 6);

  // If not enough, pad with first templates
  const displayTemplates = featured.length >= 4 ? featured :
    [...featured, ...templates.filter(t => !(t.filename in FEATURED_STATS))].slice(0, 6);

  const updateScrollButtons = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    return () => el.removeEventListener('scroll', updateScrollButtons);
  }, [displayTemplates]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 340;
    el.scrollBy({ left: direction === 'left' ? -cardWidth : cardWidth, behavior: 'smooth' });
  };

  if (displayTemplates.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Award size={18} className="text-[#D4A03C]" />
          <h2 className="text-lg font-bold text-[#36342E]">Staff Picks</h2>
          <span className="text-xs text-[#6B6960] bg-[#D4A03C]/10 text-[#D4A03C] font-semibold px-2 py-0.5 rounded">
            Featured
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            className={`p-1.5 rounded-lg transition-colors ${
              canScrollLeft ? 'hover:bg-[#F8F4F0] text-[#6B6960]' : 'text-[#ECEAE3] cursor-not-allowed'
            }`}
            aria-label="Scroll left"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            className={`p-1.5 rounded-lg transition-colors ${
              canScrollRight ? 'hover:bg-[#F8F4F0] text-[#6B6960]' : 'text-[#ECEAE3] cursor-not-allowed'
            }`}
            aria-label="Scroll right"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {displayTemplates.map((t) => {
          const category = t.category || 'Other';
          const gradient = CATEGORY_FEATURED_GRADIENT[category] || CATEGORY_FEATURED_GRADIENT.Other;
          const stats = FEATURED_STATS[t.filename] || { uses: Math.floor(Math.random() * 1500) + 200, rating: 4.5, avgTime: t.build_time || '8 min' };
          const techStack = t.tech_stack || [];

          return (
            <div
              key={t.filename}
              className="flex-shrink-0 w-[320px] bg-white border border-[#ECEAE3] rounded-xl shadow-card hover:shadow-card-hover transition-all duration-200 overflow-hidden cursor-pointer group"
              onClick={() => onPreview(t)}
            >
              {/* Large gradient header */}
              <div className={`h-36 bg-gradient-to-br ${gradient} relative overflow-hidden`}>
                {/* Decorative SVG */}
                <svg className="absolute inset-0 w-full h-full opacity-[0.12]" viewBox="0 0 320 144">
                  <circle cx="60" cy="40" r="25" fill="none" stroke="white" strokeWidth="2" />
                  <circle cx="260" cy="110" r="35" fill="none" stroke="white" strokeWidth="2" />
                  <circle cx="180" cy="25" r="10" fill="white" />
                  <rect x="220" y="15" width="30" height="30" rx="6" fill="none" stroke="white" strokeWidth="1.5" transform="rotate(20 235 30)" />
                  <line x1="40" y1="120" x2="120" y2="80" stroke="white" strokeWidth="1" />
                  <circle cx="100" cy="100" r="6" fill="white" fillOpacity="0.4" />
                  <circle cx="280" cy="50" r="15" fill="none" stroke="white" strokeWidth="1" strokeDasharray="3 3" />
                </svg>

                {/* Featured badge */}
                <div className="absolute top-3 left-3">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-white bg-white/25 backdrop-blur-sm px-2.5 py-1 rounded-full uppercase tracking-wider">
                    <Award size={11} />
                    Featured
                  </span>
                </div>

                {/* Category badge */}
                <div className="absolute top-3 right-3">
                  <span className="text-[10px] font-semibold text-white/90 bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded">
                    {category}
                  </span>
                </div>

                {/* Tech stack pills at bottom of gradient */}
                {techStack.length > 0 && (
                  <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1">
                    {techStack.slice(0, 4).map((tech) => (
                      <span key={tech} className="text-[10px] font-semibold text-white/90 bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded">
                        {tech}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Card body */}
              <div className="p-4">
                <h3 className="text-base font-bold text-[#36342E] mb-1 group-hover:text-[#553DE9] transition-colors">
                  {formatTemplateName(t.name)}
                </h3>
                <p className="text-xs text-[#6B6960] line-clamp-2 mb-3 min-h-[2.4em]">
                  {t.description || t.filename}
                </p>

                {/* Stats row */}
                <div className="flex items-center gap-3 mb-3 text-[10px] text-[#6B6960]">
                  <span className="flex items-center gap-1">
                    <Users size={11} className="text-[#553DE9]" />
                    {formatNumber(stats.uses)} uses
                  </span>
                  <span className="flex items-center gap-1">
                    <Star size={11} className="text-[#D4A03C]" fill="#D4A03C" />
                    {stats.rating}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {stats.avgTime}
                  </span>
                </div>

                {/* Action row */}
                <div className="flex items-center justify-between pt-3 border-t border-[#ECEAE3]">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 size={12} className={
                      t.difficulty === 'beginner' ? 'text-green-500' :
                      t.difficulty === 'advanced' ? 'text-red-400' : 'text-yellow-500'
                    } />
                    <span className={`text-[10px] font-medium capitalize ${
                      t.difficulty === 'beginner' ? 'text-green-500' :
                      t.difficulty === 'advanced' ? 'text-red-400' : 'text-yellow-500'
                    }`}>
                      {t.difficulty || 'Intermediate'}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    icon={Rocket}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(t.filename);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Use
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
