#!/usr/bin/env bash
#
# update-changelog.sh - Auto-generate changelog from conventional commits
#
# Usage:
#   ./scripts/update-changelog.sh [version]
#
# If version is not provided, reads from VERSION file.
# Parses commits since the last tag and updates CHANGELOG.md
#

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"
VERSION_FILE="$ROOT_DIR/VERSION"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Get version from argument or VERSION file
get_version() {
    if [[ -n "${1:-}" ]]; then
        echo "$1"
    elif [[ -f "$VERSION_FILE" ]]; then
        cat "$VERSION_FILE" | tr -d '\n'
    else
        log_error "No version provided and VERSION file not found"
        exit 1
    fi
}

# Get the last tag
get_last_tag() {
    git describe --tags --abbrev=0 2>/dev/null || echo ""
}

# Extract message from conventional commit
extract_message() {
    local subject="$1"
    # Remove type prefix like "feat(scope): " or "fix: "
    echo "$subject" | sed -E 's/^[a-z]+(\([^)]+\))?!?:\s*//'
}

# Generate changelog section for a version
generate_changelog_section() {
    local version="$1"
    local last_tag="$2"
    local date
    date=$(date +%Y-%m-%d)

    local range=""
    if [[ -n "$last_tag" ]]; then
        range="${last_tag}..HEAD"
    else
        range="HEAD"
    fi

    # Temp files for categories
    local tmp_dir
    tmp_dir=$(mktemp -d)
    touch "$tmp_dir/added" "$tmp_dir/fixed" "$tmp_dir/changed" "$tmp_dir/perf" "$tmp_dir/docs" "$tmp_dir/other"

    # Parse commits
    git log "$range" --pretty=format:"%s" --no-merges 2>/dev/null | while read -r subject; do
        [[ -z "$subject" ]] && continue

        local msg
        msg=$(extract_message "$subject")

        # Categorize by conventional commit type
        case "$subject" in
            release:*)
                # Skip release commits
                ;;
            feat*)
                echo "- $msg" >> "$tmp_dir/added"
                ;;
            fix*)
                echo "- $msg" >> "$tmp_dir/fixed"
                ;;
            docs*)
                echo "- $msg" >> "$tmp_dir/docs"
                ;;
            refactor*)
                echo "- $msg" >> "$tmp_dir/changed"
                ;;
            perf*)
                echo "- $msg" >> "$tmp_dir/perf"
                ;;
            chore*|ci*|style*|build*|test*)
                # Skip these
                ;;
            *)
                # Non-conventional commit
                echo "- $subject" >> "$tmp_dir/other"
                ;;
        esac
    done

    # Build changelog section
    echo "## [$version] - $date"
    echo ""

    local has_content=false

    if [[ -s "$tmp_dir/added" ]]; then
        echo "### Added"
        cat "$tmp_dir/added"
        echo ""
        has_content=true
    fi

    if [[ -s "$tmp_dir/fixed" ]]; then
        echo "### Fixed"
        cat "$tmp_dir/fixed"
        echo ""
        has_content=true
    fi

    if [[ -s "$tmp_dir/changed" ]]; then
        echo "### Changed"
        cat "$tmp_dir/changed"
        echo ""
        has_content=true
    fi

    if [[ -s "$tmp_dir/perf" ]]; then
        echo "### Performance"
        cat "$tmp_dir/perf"
        echo ""
        has_content=true
    fi

    if [[ -s "$tmp_dir/docs" ]]; then
        echo "### Documentation"
        cat "$tmp_dir/docs"
        echo ""
        has_content=true
    fi

    if [[ -s "$tmp_dir/other" ]]; then
        echo "### Other"
        cat "$tmp_dir/other"
        echo ""
        has_content=true
    fi

    if [[ "$has_content" == false ]]; then
        echo "### Changed"
        echo "- Version bump to $version"
        echo ""
    fi

    echo "---"

    # Cleanup
    rm -rf "$tmp_dir"
}

# Update CHANGELOG.md with new section
update_changelog() {
    local new_section="$1"
    local temp_file
    temp_file=$(mktemp)

    # Check if CHANGELOG.md exists
    if [[ ! -f "$CHANGELOG_FILE" ]]; then
        # Create new changelog
        cat > "$CHANGELOG_FILE" << 'EOF'
# Changelog

All notable changes to Loki Mode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

EOF
        echo "$new_section" >> "$CHANGELOG_FILE"
        return
    fi

    # Insert new section after the header (after line 6)
    {
        head -n 6 "$CHANGELOG_FILE"
        echo ""
        echo "$new_section"
        tail -n +8 "$CHANGELOG_FILE"
    } > "$temp_file"

    mv "$temp_file" "$CHANGELOG_FILE"
}

# Check if version already exists in changelog
version_exists() {
    local version="$1"
    grep -q "## \[$version\]" "$CHANGELOG_FILE" 2>/dev/null
}

# Main
main() {
    local version
    version=$(get_version "${1:-}")

    log_info "Updating changelog for version $version"

    # Check if version already in changelog
    if version_exists "$version"; then
        log_warn "Version $version already exists in CHANGELOG.md, skipping"
        exit 0
    fi

    # Get last tag
    local last_tag
    last_tag=$(get_last_tag)

    if [[ -n "$last_tag" ]]; then
        log_info "Parsing commits since $last_tag"
    else
        log_info "No previous tag found, parsing all commits"
    fi

    # Generate new section
    local new_section
    new_section=$(generate_changelog_section "$version" "$last_tag")

    # Update changelog
    update_changelog "$new_section"

    log_success "CHANGELOG.md updated for version $version"

    # Show the new section
    echo ""
    echo "New changelog section:"
    echo "----------------------"
    echo "$new_section"
}

main "$@"
