#!/usr/bin/env bash
# setup_validator.sh — Bootstrap the Vertex AI Agent Validator environment
# Ref: https://cloud.google.com/vertex-ai/docs/start/install-sdk
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/../.venv-vertex-validator"
REQUIREMENTS="${SCRIPT_DIR}/requirements.txt"

info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()      { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()    { echo -e "${RED}[FAIL]${RESET}  $*"; }

# ── 1. Python 3.9+ ───────────────────────────────────────────────────────────
info "Checking Python version..."
if ! command -v python3 &>/dev/null; then
    fail "python3 not found. Install Python 3.9+ first."
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)

if [[ "$PYTHON_MAJOR" -lt 3 ]] || { [[ "$PYTHON_MAJOR" -eq 3 ]] && [[ "$PYTHON_MINOR" -lt 9 ]]; }; then
    fail "Python 3.9+ required, found ${PYTHON_VERSION}"
    exit 1
fi
ok "Python ${PYTHON_VERSION} detected"

# ── 2. Virtual Environment (optional) ────────────────────────────────────────
if [[ "${SKIP_VENV:-}" == "1" ]]; then
    info "Skipping virtualenv (SKIP_VENV=1)"
else
    if [[ -d "$VENV_DIR" ]]; then
        info "Existing virtualenv found at ${VENV_DIR}"
    else
        info "Creating virtualenv at ${VENV_DIR}..."
        python3 -m venv "$VENV_DIR"
        ok "Virtualenv created"
    fi
    # shellcheck disable=SC1091
    source "${VENV_DIR}/bin/activate"
    ok "Virtualenv activated ($(which python3))"
fi

# ── 3. Install Dependencies ──────────────────────────────────────────────────
if [[ ! -f "$REQUIREMENTS" ]]; then
    fail "requirements.txt not found at ${REQUIREMENTS}"
    exit 1
fi

info "Installing Python dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r "$REQUIREMENTS"
ok "All dependencies installed"

# ── 4. Verify gcloud Auth ────────────────────────────────────────────────────
info "Checking gcloud authentication..."
if ! command -v gcloud &>/dev/null; then
    fail "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)
if [[ -z "$ACTIVE_ACCOUNT" ]]; then
    fail "No active gcloud account. Run: gcloud auth login"
    exit 1
fi
ok "Authenticated as ${BOLD}${ACTIVE_ACCOUNT}${RESET}"

# ── 5. Check Application Default Credentials ─────────────────────────────────
info "Checking Application Default Credentials..."
if gcloud auth application-default print-access-token &>/dev/null 2>&1; then
    ok "Application Default Credentials available"
else
    warn "ADC not configured. Python SDK calls may fail."
    warn "Run: gcloud auth application-default login"
fi

# ── 6. Check Required APIs ───────────────────────────────────────────────────
PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [[ -z "$PROJECT" ]]; then
    warn "No default project set. Skipping API checks."
    warn "Set one with: gcloud config set project PROJECT_ID"
else
    info "Checking required APIs for project ${BOLD}${PROJECT}${RESET}..."

    REQUIRED_APIS=(
        "aiplatform.googleapis.com"     # Vertex AI
        "monitoring.googleapis.com"     # Cloud Monitoring
        "logging.googleapis.com"        # Cloud Logging
    )

    OPTIONAL_APIS=(
        "secretmanager.googleapis.com"  # Secret Manager
        "cloudresourcemanager.googleapis.com"  # Resource Manager
        "accesscontextmanager.googleapis.com"  # VPC-SC
    )

    ENABLED_APIS=$(gcloud services list --enabled --format='value(config.name)' --project="$PROJECT" 2>/dev/null || echo "")

    ALL_GOOD=true
    for api in "${REQUIRED_APIS[@]}"; do
        if echo "$ENABLED_APIS" | grep -q "^${api}$"; then
            ok "  ${api}"
        else
            fail "  ${api} — NOT ENABLED (required)"
            ALL_GOOD=false
        fi
    done

    for api in "${OPTIONAL_APIS[@]}"; do
        if echo "$ENABLED_APIS" | grep -q "^${api}$"; then
            ok "  ${api}"
        else
            warn "  ${api} — not enabled (optional, some checks will skip)"
        fi
    done

    if [[ "$ALL_GOOD" == false ]]; then
        echo ""
        warn "Enable missing APIs with:"
        warn "  gcloud services enable API_NAME --project=${PROJECT}"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Setup complete.${RESET}"
echo ""
echo "Next steps:"
echo "  1. Activate the venv:  source ${VENV_DIR}/bin/activate"
echo "  2. Run all checks:     python3 ${SCRIPT_DIR}/run_all_checks.py --project PROJECT_ID"
echo "  3. Dry-run first:      python3 ${SCRIPT_DIR}/run_all_checks.py --project PROJECT_ID --dry-run"
echo ""
