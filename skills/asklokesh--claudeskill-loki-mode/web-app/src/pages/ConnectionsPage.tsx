import { Link } from 'lucide-react';
import { DeployConnections } from '../components/DeployConnections';

export default function ConnectionsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-xl font-bold text-ink flex items-center gap-2">
            <Link size={22} className="text-primary" />
            Deploy Connections
          </h1>
          <p className="text-sm text-muted mt-1">
            Connect your deployment platforms to enable one-click deploys from Purple Lab.
            Tokens are stored securely on the server and never exposed in the browser.
          </p>
        </div>

        {/* Separator */}
        <div className="border-t border-border" />

        {/* Full connections panel */}
        <DeployConnections />
      </div>
    </div>
  );
}
