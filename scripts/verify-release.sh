#!/usr/bin/env bash
# SoftDB Release Verification Script
# Verifies downloaded binaries using Sigstore/Cosign
#
# Usage:
#   ./scripts/verify-release.sh <file> [<bundle>]
#
# Examples:
#   ./scripts/verify-release.sh SoftDB-amd64-installer.exe
#   ./scripts/verify-release.sh SoftDB-linux-amd64.AppImage SoftDB-linux-amd64.AppImage.bundle

set -euo pipefail

REPO_IDENTITY="https://github.com/zane-tv/soft-db"
OIDC_ISSUER="https://token.actions.githubusercontent.com"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ $# -lt 1 ]; then
  echo -e "${YELLOW}Usage:${NC} $0 <file> [<bundle>]"
  echo ""
  echo "Downloads the .bundle signature file automatically if not provided."
  echo ""
  echo "Examples:"
  echo "  $0 SoftDB-amd64-installer.exe"
  echo "  $0 SoftDB-linux-amd64.AppImage"
  exit 1
fi

FILE="$1"
BUNDLE="${2:-${FILE}.bundle}"

# Check cosign is installed
if ! command -v cosign &>/dev/null; then
  echo -e "${RED}Error:${NC} cosign is not installed."
  echo ""
  echo "Install cosign:"
  echo "  macOS:  brew install cosign"
  echo "  Linux:  go install github.com/sigstore/cosign/v2/cmd/cosign@latest"
  echo "  Other:  https://docs.sigstore.dev/cosign/system_config/installation/"
  exit 1
fi

# Check files exist
if [ ! -f "$FILE" ]; then
  echo -e "${RED}Error:${NC} File not found: $FILE"
  exit 1
fi

if [ ! -f "$BUNDLE" ]; then
  echo -e "${YELLOW}Bundle not found locally. Attempting to download from latest release...${NC}"
  BUNDLE_NAME=$(basename "$BUNDLE")
  DOWNLOAD_URL="https://github.com/zane-tv/soft-db/releases/latest/download/${BUNDLE_NAME}"
  if curl -fsSL -o "$BUNDLE" "$DOWNLOAD_URL" 2>/dev/null; then
    echo -e "Downloaded: $BUNDLE_NAME"
  else
    echo -e "${RED}Error:${NC} Could not download bundle from: $DOWNLOAD_URL"
    echo "Please download the .bundle file manually from the release page."
    exit 1
  fi
fi

echo "Verifying: $FILE"
echo "Bundle:    $BUNDLE"
echo ""

if cosign verify-blob "$FILE" \
  --bundle "$BUNDLE" \
  --certificate-identity-regexp "${REPO_IDENTITY}" \
  --certificate-oidc-issuer "${OIDC_ISSUER}" 2>/dev/null; then
  echo ""
  echo -e "${GREEN}✅ Verification PASSED${NC}"
  echo "This file was built by GitHub Actions from the official SoftDB repository."
  echo "It has not been modified since signing."
else
  echo ""
  echo -e "${RED}❌ Verification FAILED${NC}"
  echo "This file may have been tampered with or was not built from the official repository."
  echo "Do NOT install this binary."
  exit 1
fi
