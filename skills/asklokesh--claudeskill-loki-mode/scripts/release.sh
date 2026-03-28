#!/usr/bin/env bash
#
# release.sh - Automated release script for Loki Mode
#
# Usage:
#   ./scripts/release.sh patch|minor|major [--dry-run]
#
# This script:
#   1. Bumps version in VERSION, package.json, vscode-extension/package.json
#   2. Updates CHANGELOG.md from conventional commits
#   3. Commits and pushes (triggers GitHub Actions release workflow)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_step() { echo -e "${CYAN}[STEP]${NC} $*"; }

DRY_RUN="false"

# Parse arguments
parse_args() {
    local bump_type=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            patch|minor|major)
                bump_type="$1"
                ;;
            --dry-run)
                DRY_RUN="true"
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown argument: $1"
                usage
                exit 1
                ;;
        esac
        shift
    done

    if [[ -z "$bump_type" ]]; then
        log_error "Bump type required: patch, minor, or major"
        usage
        exit 1
    fi

    echo "$bump_type"
}

usage() {
    cat << EOF
Usage: $(basename "$0") <patch|minor|major> [--dry-run]

Arguments:
  patch    Bump patch version (x.y.Z)
  minor    Bump minor version (x.Y.0)
  major    Bump major version (X.0.0)

Options:
  --dry-run  Show what would be done without making changes
  -h, --help Show this help message

Examples:
  $(basename "$0") patch          # 5.8.2 -> 5.8.3
  $(basename "$0") minor          # 5.8.2 -> 5.9.0
  $(basename "$0") major          # 5.8.2 -> 6.0.0
  $(basename "$0") patch --dry-run
EOF
}

# Get current version from VERSION file
get_current_version() {
    if [[ -f "$ROOT_DIR/VERSION" ]]; then
        cat "$ROOT_DIR/VERSION" | tr -d '\n'
    else
        echo "0.0.0"
    fi
}

# Bump version based on type
bump_version() {
    local current="$1"
    local type="$2"

    IFS='.' read -r major minor patch <<< "$current"

    case "$type" in
        major)
            echo "$((major + 1)).0.0"
            ;;
        minor)
            echo "$major.$((minor + 1)).0"
            ;;
        patch)
            echo "$major.$minor.$((patch + 1))"
            ;;
    esac
}

# Update version in a file
update_version_in_file() {
    local file="$1"
    local old_version="$2"
    local new_version="$3"

    if [[ ! -f "$file" ]]; then
        log_warn "File not found: $file"
        return
    fi

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY-RUN] Would update $file: $old_version -> $new_version"
        return
    fi

    # Use sed to replace version
    if [[ "$file" == *"package.json" ]]; then
        # JSON files - update "version": "x.y.z"
        sed -i '' "s/\"version\": \"$old_version\"/\"version\": \"$new_version\"/" "$file"
    else
        # Plain text VERSION file
        echo "$new_version" > "$file"
    fi

    log_success "Updated $file"
}

# Check for uncommitted changes
check_git_status() {
    if [[ -n "$(git status --porcelain)" ]]; then
        log_warn "You have uncommitted changes:"
        git status --short
        echo ""
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_error "Aborted"
            exit 1
        fi
    fi
}

# Main release process
main() {
    cd "$ROOT_DIR"

    local bump_type
    bump_type=$(parse_args "$@")

    local current_version
    current_version=$(get_current_version)

    local new_version
    new_version=$(bump_version "$current_version" "$bump_type")

    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  Loki Mode Release${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    echo -e "  Current version: ${YELLOW}$current_version${NC}"
    echo -e "  New version:     ${GREEN}$new_version${NC}"
    echo -e "  Bump type:       ${BLUE}$bump_type${NC}"
    if [ "$DRY_RUN" = "true" ]; then
        echo -e "  Mode:            ${YELLOW}DRY RUN${NC}"
    fi
    echo ""

    if [ "$DRY_RUN" != "true" ]; then
        read -p "Proceed with release? (y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_error "Aborted"
            exit 1
        fi
    else
        log_info "[DRY-RUN] Would proceed with release"
    fi

    # Check git status
    log_step "Checking git status..."
    if [ "$DRY_RUN" != "true" ]; then
        check_git_status
    else
        log_info "[DRY-RUN] Skipping git status check"
    fi

    # Step 1: Update version files
    log_step "Updating version files..."
    update_version_in_file "$ROOT_DIR/VERSION" "$current_version" "$new_version"
    update_version_in_file "$ROOT_DIR/package.json" "$current_version" "$new_version"
    update_version_in_file "$ROOT_DIR/vscode-extension/package.json" "$current_version" "$new_version"

    # Step 2: Update changelog
    log_step "Updating CHANGELOG.md..."
    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY-RUN] Would run: ./scripts/update-changelog.sh $new_version"
    else
        "$SCRIPT_DIR/update-changelog.sh" "$new_version"
    fi

    # Step 3: Git commit
    log_step "Creating git commit..."
    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY-RUN] Would commit: release: v$new_version"
    else
        git add VERSION package.json vscode-extension/package.json CHANGELOG.md
        git commit -m "release: v$new_version"
    fi

    # Step 4: Push
    log_step "Pushing to remote..."
    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY-RUN] Would push to origin main"
    else
        git push origin main
    fi

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Release v$new_version initiated!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "GitHub Actions will now:"
    echo "  1. Create git tag v$new_version"
    echo "  2. Create GitHub Release"
    echo "  3. Publish to npm"
    echo "  4. Build and push Docker image"
    echo "  5. Publish VS Code extension"
    echo "  6. Update Homebrew tap"
    echo ""
    echo "Watch progress:"
    echo "  gh run list --workflow=Release --limit 1"
    echo "  gh run watch"
    echo ""
}

main "$@"
