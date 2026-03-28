import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] p-8 text-center">
      <div className="text-6xl font-heading font-bold text-primary/20 mb-4">404</div>
      <h1 className="text-h3 font-heading font-bold text-ink mb-2">Page not found</h1>
      <p className="text-sm text-muted-accessible mb-6 max-w-xs">
        The page you are looking for does not exist or has been moved.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-btn border border-border text-secondary hover:bg-hover transition-colors"
        >
          <ArrowLeft size={14} />
          Go Back
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-btn bg-primary text-white hover:bg-[#4432c4] transition-colors shadow-button"
        >
          <Home size={14} />
          Home
        </Link>
      </div>
    </div>
  );
}
