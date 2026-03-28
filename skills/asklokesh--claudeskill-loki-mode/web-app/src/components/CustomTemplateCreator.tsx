import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/Button';
import {
  ArrowLeft, ArrowRight, FileText, Layers, Settings, Check,
  Rocket, Sparkles,
} from 'lucide-react';

const STEPS = [
  { label: 'Basics', icon: FileText },
  { label: 'Tech Stack', icon: Layers },
  { label: 'Features', icon: Settings },
  { label: 'Review', icon: Check },
];

const TECH_OPTIONS = [
  { id: 'react', label: 'React', group: 'Frontend' },
  { id: 'nextjs', label: 'Next.js', group: 'Frontend' },
  { id: 'vue', label: 'Vue', group: 'Frontend' },
  { id: 'svelte', label: 'Svelte', group: 'Frontend' },
  { id: 'tailwind', label: 'Tailwind CSS', group: 'Frontend' },
  { id: 'nodejs', label: 'Node.js', group: 'Backend' },
  { id: 'python', label: 'Python', group: 'Backend' },
  { id: 'fastapi', label: 'FastAPI', group: 'Backend' },
  { id: 'express', label: 'Express', group: 'Backend' },
  { id: 'typescript', label: 'TypeScript', group: 'Language' },
  { id: 'postgresql', label: 'PostgreSQL', group: 'Database' },
  { id: 'mongodb', label: 'MongoDB', group: 'Database' },
  { id: 'sqlite', label: 'SQLite', group: 'Database' },
  { id: 'redis', label: 'Redis', group: 'Database' },
  { id: 'docker', label: 'Docker', group: 'DevOps' },
  { id: 'prisma', label: 'Prisma', group: 'ORM' },
];

const FEATURE_OPTIONS = [
  { id: 'auth', label: 'Authentication', description: 'Email/password and OAuth login' },
  { id: 'database', label: 'Database', description: 'Schema, models, and migrations' },
  { id: 'api', label: 'REST API', description: 'CRUD endpoints with validation' },
  { id: 'tests', label: 'Tests', description: 'Unit and integration test setup' },
  { id: 'docker', label: 'Docker', description: 'Dockerfile and compose setup' },
  { id: 'ci', label: 'CI/CD', description: 'GitHub Actions workflow' },
  { id: 'websockets', label: 'WebSockets', description: 'Real-time communication' },
  { id: 'fileupload', label: 'File Upload', description: 'Image and document handling' },
  { id: 'email', label: 'Email', description: 'Transactional email sending' },
  { id: 'payments', label: 'Payments', description: 'Stripe payment integration' },
  { id: 'admin', label: 'Admin Panel', description: 'Dashboard for management' },
  { id: 'i18n', label: 'Internationalization', description: 'Multi-language support' },
];

interface CustomTemplateCreatorProps {
  onClose: () => void;
}

export function CustomTemplateCreator({ onClose }: CustomTemplateCreatorProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTech, setSelectedTech] = useState<Set<string>>(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());

  const toggleTech = useCallback((id: string) => {
    setSelectedTech(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFeature = useCallback((id: string) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const canProceed = (): boolean => {
    switch (step) {
      case 0: return name.trim().length > 0;
      case 1: return selectedTech.size > 0;
      case 2: return true; // Features are optional
      case 3: return true;
      default: return false;
    }
  };

  const handleGenerate = useCallback(() => {
    const techList = TECH_OPTIONS.filter(t => selectedTech.has(t.id)).map(t => t.label);
    const featureList = FEATURE_OPTIONS.filter(f => selectedFeatures.has(f.id)).map(f => f.label);

    const prompt = [
      `Build a project called "${name}"`,
      description ? `: ${description}` : '',
      techList.length ? `\n\nTech stack: ${techList.join(', ')}` : '',
      featureList.length ? `\nFeatures: ${featureList.join(', ')}` : '',
    ].join('');

    sessionStorage.setItem('pl_custom_prompt', prompt);
    navigate('/');
    onClose();
  }, [name, description, selectedTech, selectedFeatures, navigate, onClose]);

  // Group tech options by group
  const techGroups = TECH_OPTIONS.reduce<Record<string, typeof TECH_OPTIONS>>((acc, t) => {
    if (!acc[t.group]) acc[t.group] = [];
    acc[t.group].push(t);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative bg-white rounded-xl shadow-2xl w-[95vw] max-w-[700px] overflow-hidden"
        style={{ animation: 'modal-enter 0.25s ease-out' }}
      >
        {/* Progress bar */}
        <div className="bg-[#FAF9F6] border-b border-[#ECEAE3] px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-[#36342E]">Create Custom Template</h2>
            <button
              onClick={onClose}
              className="text-[#6B6960] hover:text-[#36342E] text-sm"
            >
              Cancel
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === step;
              const isDone = i < step;
              return (
                <div key={i} className="flex items-center gap-2 flex-1">
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                    isActive ? 'bg-[#553DE9] text-white' :
                    isDone ? 'bg-[#1FC5A8]/10 text-[#1FC5A8]' :
                    'bg-[#F8F4F0] text-[#6B6960]'
                  }`}>
                    {isDone ? <Check size={12} /> : <Icon size={12} />}
                    <span className="hidden sm:inline">{s.label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 rounded ${isDone ? 'bg-[#1FC5A8]' : 'bg-[#ECEAE3]'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step content */}
        <div className="p-6 min-h-[320px]">
          {/* Step 1: Basics */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#36342E] mb-1.5">
                  Project Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="My Awesome App"
                  className="w-full px-4 py-2.5 text-sm bg-white border border-[#ECEAE3] rounded-lg outline-none focus:border-[#553DE9] transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#36342E] mb-1.5">
                  Description <span className="text-xs text-[#6B6960]">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what your project does..."
                  rows={4}
                  className="w-full px-4 py-2.5 text-sm bg-white border border-[#ECEAE3] rounded-lg outline-none focus:border-[#553DE9] transition-colors resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 2: Tech Stack */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-[#6B6960]">Select the technologies for your project.</p>
              {Object.entries(techGroups).map(([group, techs]) => (
                <div key={group}>
                  <h4 className="text-xs font-semibold text-[#6B6960] uppercase tracking-wider mb-2">{group}</h4>
                  <div className="flex flex-wrap gap-2">
                    {techs.map((tech) => {
                      const isSelected = selectedTech.has(tech.id);
                      return (
                        <button
                          key={tech.id}
                          onClick={() => toggleTech(tech.id)}
                          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                            isSelected
                              ? 'border-[#553DE9] bg-[#553DE9]/10 text-[#553DE9] font-medium'
                              : 'border-[#ECEAE3] text-[#6B6960] hover:border-[#553DE9]/30 hover:text-[#36342E]'
                          }`}
                        >
                          {isSelected && <Check size={12} className="inline mr-1" />}
                          {tech.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Features */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-[#6B6960] mb-2">Select features to include. All are optional.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FEATURE_OPTIONS.map((feature) => {
                  const isSelected = selectedFeatures.has(feature.id);
                  return (
                    <button
                      key={feature.id}
                      onClick={() => toggleFeature(feature.id)}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-[#553DE9] bg-[#553DE9]/5'
                          : 'border-[#ECEAE3] hover:border-[#553DE9]/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected ? 'bg-[#553DE9] border-[#553DE9]' : 'border-[#ECEAE3]'
                        }`}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                        <span className={`text-sm font-medium ${isSelected ? 'text-[#553DE9]' : 'text-[#36342E]'}`}>
                          {feature.label}
                        </span>
                      </div>
                      <p className="text-xs text-[#6B6960] ml-6">{feature.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-[#FAF9F6] rounded-lg border border-[#ECEAE3] p-4">
                <h4 className="text-sm font-semibold text-[#36342E] mb-1">{name || 'Untitled Project'}</h4>
                {description && <p className="text-xs text-[#6B6960] mb-3">{description}</p>}

                {selectedTech.size > 0 && (
                  <div className="mb-3">
                    <span className="text-xs font-semibold text-[#6B6960] uppercase tracking-wider">Tech Stack</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {TECH_OPTIONS.filter(t => selectedTech.has(t.id)).map(t => (
                        <span key={t.id} className="text-xs bg-[#553DE9]/10 text-[#553DE9] px-2 py-0.5 rounded font-medium">
                          {t.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedFeatures.size > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-[#6B6960] uppercase tracking-wider">Features</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {FEATURE_OPTIONS.filter(f => selectedFeatures.has(f.id)).map(f => (
                        <span key={f.id} className="text-xs bg-[#1FC5A8]/10 text-[#1FC5A8] px-2 py-0.5 rounded font-medium">
                          {f.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-[#553DE9]/5 rounded-lg border border-[#553DE9]/10 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={15} className="text-[#553DE9]" />
                  <span className="text-sm font-semibold text-[#553DE9]">Generated Prompt</span>
                </div>
                <p className="text-sm text-[#6B6960] font-mono bg-white rounded border border-[#ECEAE3] p-3 text-xs leading-relaxed">
                  Build a project called "{name}"{description ? `: ${description}` : ''}
                  {selectedTech.size > 0 && (
                    <>
                      <br /><br />Tech stack: {TECH_OPTIONS.filter(t => selectedTech.has(t.id)).map(t => t.label).join(', ')}
                    </>
                  )}
                  {selectedFeatures.size > 0 && (
                    <>
                      <br />Features: {FEATURE_OPTIONS.filter(f => selectedFeatures.has(f.id)).map(f => f.label).join(', ')}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="border-t border-[#ECEAE3] px-6 py-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="md"
            icon={ArrowLeft}
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </Button>

          {step < 3 ? (
            <Button
              variant="primary"
              size="md"
              iconRight={ArrowRight}
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              icon={Rocket}
              onClick={handleGenerate}
            >
              Generate Template
            </Button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes modal-enter {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
