import {
  Globe, Server, Terminal, Bot, Database, Package,
} from 'lucide-react';
import type { TemplateMetadata } from '../types/api';

type Category = 'all' | 'Website' | 'API' | 'CLI' | 'Bot' | 'Data' | 'Other';

interface CategoryInfo {
  key: Category;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  gradient: string;
  borderAccent: string;
}

const CATEGORY_INFO: CategoryInfo[] = [
  {
    key: 'Website',
    label: 'Web Apps',
    icon: Globe,
    description: 'Full-stack web applications, landing pages, dashboards, and SaaS starters',
    gradient: 'from-violet-500 to-indigo-600',
    borderAccent: 'hover:border-violet-300',
  },
  {
    key: 'API',
    label: 'APIs',
    icon: Server,
    description: 'REST APIs, GraphQL servers, microservices, and backend services',
    gradient: 'from-teal-500 to-emerald-600',
    borderAccent: 'hover:border-teal-300',
  },
  {
    key: 'CLI',
    label: 'CLIs',
    icon: Terminal,
    description: 'Command-line tools, dev utilities, automation scripts, and npm packages',
    gradient: 'from-slate-500 to-blue-600',
    borderAccent: 'hover:border-slate-300',
  },
  {
    key: 'Bot',
    label: 'Bots',
    icon: Bot,
    description: 'Discord bots, Slack bots, chat integrations, and automation agents',
    gradient: 'from-orange-500 to-pink-600',
    borderAccent: 'hover:border-orange-300',
  },
  {
    key: 'Data',
    label: 'Data',
    icon: Database,
    description: 'Data pipelines, web scrapers, analytics dashboards, and ETL tools',
    gradient: 'from-blue-500 to-purple-600',
    borderAccent: 'hover:border-blue-300',
  },
  {
    key: 'Other',
    label: 'Other',
    icon: Package,
    description: 'Browser extensions, games, mobile apps, and unique project types',
    gradient: 'from-gray-500 to-zinc-600',
    borderAccent: 'hover:border-gray-300',
  },
];

interface TemplateCategoriesProps {
  templates: TemplateMetadata[];
  onSelectCategory: (category: Category) => void;
}

export function TemplateCategories({ templates, onSelectCategory }: TemplateCategoriesProps) {
  const getCategoryCount = (key: Category): number => {
    if (key === 'all') return templates.length;
    return templates.filter(t => (t.category || 'Other') === key).length;
  };

  const getCategoryTemplates = (key: Category): TemplateMetadata[] => {
    if (key === 'all') return templates.slice(0, 3);
    return templates.filter(t => (t.category || 'Other') === key).slice(0, 3);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {CATEGORY_INFO.map((cat) => {
        const count = getCategoryCount(cat.key);
        const topTemplates = getCategoryTemplates(cat.key);
        const Icon = cat.icon;

        return (
          <button
            key={cat.key}
            onClick={() => onSelectCategory(cat.key)}
            className={`group text-left bg-white border border-[#ECEAE3] rounded-xl p-5 shadow-card hover:shadow-card-hover transition-all duration-200 cursor-pointer ${cat.borderAccent}`}
          >
            {/* Icon and count */}
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${cat.gradient} flex items-center justify-center`}>
                <Icon size={20} className="text-white" />
              </div>
              <span className="text-xs font-semibold text-[#6B6960] bg-[#F8F4F0] px-2 py-0.5 rounded">
                {count} template{count !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Title and description */}
            <h3 className="text-base font-semibold text-[#36342E] mb-1 group-hover:text-[#553DE9] transition-colors">
              {cat.label}
            </h3>
            <p className="text-xs text-[#6B6960] leading-relaxed mb-3 line-clamp-2">
              {cat.description}
            </p>

            {/* Top template names */}
            {topTemplates.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {topTemplates.map((t) => (
                  <span
                    key={t.filename}
                    className="text-[10px] font-medium text-[#553DE9] bg-[#553DE9]/8 px-2 py-0.5 rounded"
                  >
                    {t.name.replace(/\.md$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
