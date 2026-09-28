// ponytail: no hardcoded release list; a static list goes stale (it showed
// March 2026 v6.x as "recent" while VERSION was 9.x). Link to the source instead.
export function ChangelogWidget() {
  return (
    <div className="bg-white border border-[#ECEAE3] rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-[#36342E]">Changelog</h4>
        <a
          href="https://github.com/asklokesh/loki-mode/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#553DE9] hover:text-[#4832c7] font-medium"
        >
          View all
        </a>
      </div>
      <p className="text-xs text-[#6B6960]">
        Release notes for every version are kept in CHANGELOG.md on GitHub.
      </p>
    </div>
  );
}
