#!/bin/bash
# CALENDAR SAFEGUARDS - ONE-SHOT INSTALL
# 
# INSTRUCTIONS FOR CURSOR/AI:
# 1. Save this file as "install_safeguards.sh" in your repo root
# 2. Run: bash install_safeguards.sh
# 3. Do NOT modify this script
# 4. Do NOT run from subdirectories
# 
# This script will:
#   - Install pre-commit hook (blocks bad commits)
#   - Install GitHub Actions workflow (tests PRs)
#   - Verify everything works

set -e  # Exit immediately on any error

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   CALENDAR SAFEGUARDS INSTALLER                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# STEP 1: Verify we're in repo root
# ============================================================
echo "Step 1: Checking location..."

if [ ! -d ".git" ]; then
  echo "❌ ERROR: Not in a git repository root"
  echo ""
  echo "Fix:"
  echo "  cd /path/to/your/repo"
  echo "  bash install_safeguards.sh"
  echo ""
  exit 1
fi

echo "✓ In git repository root"
echo ""

# ============================================================
# STEP 2: Verify required files exist
# ============================================================
echo "Step 2: Checking for required files..."

MISSING=0

if [ ! -f "pre_commit_audit.sh" ]; then
  echo "❌ Missing: pre_commit_audit.sh"
  MISSING=1
else
  echo "✓ Found: pre_commit_audit.sh"
fi

if [ ! -f "github_workflow_test.yml" ]; then
  echo "❌ Missing: github_workflow_test.yml"
  MISSING=1
else
  echo "✓ Found: github_workflow_test.yml"
fi

if [ $MISSING -eq 1 ]; then
  echo ""
  echo "ERROR: Missing required files"
  echo ""
  echo "Fix:"
  echo "  1. Download files from /mnt/user-data/outputs/"
  echo "  2. Copy to repo root:"
  echo "     cp /mnt/user-data/outputs/pre_commit_audit.sh ."
  echo "     cp /mnt/user-data/outputs/github_workflow_test.yml ."
  echo "  3. Run this script again"
  echo ""
  exit 1
fi

echo ""

# ============================================================
# STEP 3: Make audit script executable
# ============================================================
echo "Step 3: Making audit script executable..."

chmod +x pre_commit_audit.sh

if [ -x "pre_commit_audit.sh" ]; then
  echo "✓ Audit script is now executable"
else
  echo "❌ Failed to make executable"
  exit 1
fi

echo ""

# ============================================================
# STEP 4: Install git pre-commit hook
# ============================================================
echo "Step 4: Installing git pre-commit hook..."

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Remove existing hook if present
if [ -f ".git/hooks/pre-commit" ] || [ -L ".git/hooks/pre-commit" ]; then
  echo "  ⚠️  Existing pre-commit hook found - backing up..."
  mv .git/hooks/pre-commit .git/hooks/pre-commit.backup.$(date +%s)
  echo "  ✓ Backup created"
fi

# Create symlink to audit script
ln -sf ../../pre_commit_audit.sh .git/hooks/pre-commit

if [ -L ".git/hooks/pre-commit" ]; then
  echo "✓ Pre-commit hook installed"
else
  echo "❌ Failed to install hook"
  exit 1
fi

echo ""

# ============================================================
# STEP 5: Install GitHub Actions workflow
# ============================================================
echo "Step 5: Installing GitHub Actions workflow..."

# Create workflows directory
mkdir -p .github/workflows

# Backup existing test workflow if present
if [ -f ".github/workflows/test.yml" ]; then
  echo "  ⚠️  Existing test.yml found - backing up..."
  mv .github/workflows/test.yml .github/workflows/test.yml.backup.$(date +%s)
  echo "  ✓ Backup created"
fi

# Copy workflow file
cp github_workflow_test.yml .github/workflows/test.yml

if [ -f ".github/workflows/test.yml" ]; then
  echo "✓ GitHub Actions workflow installed"
else
  echo "❌ Failed to install workflow"
  exit 1
fi

echo ""

# ============================================================
# STEP 6: Test the audit script
# ============================================================
echo "Step 6: Testing audit script..."
echo ""
echo "────────────────────────────────────────────────────────────"

./pre_commit_audit.sh

AUDIT_RESULT=$?

echo "────────────────────────────────────────────────────────────"
echo ""

if [ $AUDIT_RESULT -ne 0 ]; then
  echo "⚠️  AUDIT FAILED"
  echo ""
  echo "This means your codebase has wrong dates that need fixing."
  echo "Review the audit output above to see what needs correction."
  echo ""
  echo "Installation succeeded, but you need to fix the issues before committing."
  echo ""
  exit 0
fi

# ============================================================
# SUCCESS!
# ============================================================
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║   ✅ INSTALLATION COMPLETE - READY TO SHIP                ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "What was installed:"
echo "  ✓ Git pre-commit hook at: .git/hooks/pre-commit"
echo "  ✓ GitHub Actions workflow at: .github/workflows/test.yml"
echo "  ✓ Audit passed - no wrong dates found"
echo ""
echo "What happens now:"
echo "  • Every commit will be checked for wrong dates (hook blocks bad commits)"
echo "  • Every PR will run tests automatically (CI blocks bad merges)"
echo "  • Audit checks 5 critical dates + 2 required comments"
echo ""
echo "Next steps:"
echo "  1. Choose canonical slugs: henti/paipi (recommended)"
echo "  2. Update test file line 245 with chosen slugs"
echo "  3. Run: flutter test test/kemetic_calendar_golden_test.dart"
echo "  4. Commit: git commit -F COMMIT_MESSAGE.txt"
echo ""
echo "Try it now:"
echo "  ./pre_commit_audit.sh  # Run audit manually anytime"
echo ""
echo "🚀 Ready to ship!"
echo ""
