#!/bin/bash
# Pre-commit audit script - catches lingering wrong dates
# Run this before committing calendar changes

echo "🔍 Checking for incorrect dates..."
echo ""

# Track if we found any issues
ISSUES=0

# No stray wrong dates (exclude build dirs, git, and this script):
echo "Checking for old Y4 start date (March 20, 2028)..."
if grep -R "March 20, 2028" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=build \
    --exclude-dir=.dart_tool \
    --exclude="*.bin" \
    --exclude="*.js" \
    --exclude="pre_commit_audit.sh" \
    -n . 2>/dev/null | grep -v "Y3 Epi 6" | grep -v "epagomenal.*6" | grep -v "Checking for"; then
  echo "✗ Found old Y4 start (should be Mar 21, 2028)"
  ISSUES=$((ISSUES + 1))
else
  echo "✓ No old Y4 start dates found"
fi
echo ""

echo "Checking for old epagomenal span (March 14-19, 2028)..."
if grep -R "March 14-19, 2028\|14-19.*2028" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=build \
    --exclude-dir=.dart_tool \
    --exclude="*.bin" \
    --exclude="*.js" \
    --exclude="pre_commit_audit.sh" \
    -n . 2>/dev/null; then
  echo "✗ Found old epagomenal span (should be Mar 15-20, 2028)"
  ISSUES=$((ISSUES + 1))
else
  echo "✓ No old epagomenal span found"
fi
echo ""

echo "Checking for old DST spring date (March 10, 2025)..."
if grep -R "March 10, 2025" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=build \
    --exclude-dir=.dart_tool \
    --exclude="*.bin" \
    --exclude="*.js" \
    --exclude="pre_commit_audit.sh" \
    -n . 2>/dev/null; then
  echo "✗ Found old DST spring date (should be Mar 9, 2025)"
  ISSUES=$((ISSUES + 1))
else
  echo "✓ No old DST spring date found"
fi
echo ""

echo "Checking for old DST fall date (November 3, 2025)..."
if grep -R "November 3, 2025" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=build \
    --exclude-dir=.dart_tool \
    --exclude="*.bin" \
    --exclude="*.js" \
    --exclude="pre_commit_audit.sh" \
    -n . 2>/dev/null; then
  echo "✗ Found old DST fall date (should be Nov 2, 2025)"
  ISSUES=$((ISSUES + 1))
else
  echo "✓ No old DST fall date found"
fi
echo ""

echo "Checking for old Y8 start date (March 21, 2032)..."
if grep -R "March 21, 2032" \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=build \
    --exclude-dir=.dart_tool \
    --exclude="*.bin" \
    --exclude="*.js" \
    --exclude="pre_commit_audit.sh" \
    -n . 2>/dev/null; then
  echo "✗ Found old Y8 start (should be Mar 22, 2032)"
  ISSUES=$((ISSUES + 1))
else
  echo "✓ No old Y8 start dates found"
fi
echo ""

# Ensure day-card data stays year-agnostic:
echo "Checking for year-agnostic day-card invariant in kemetic_day_info.dart..."
if grep -R "KEMETIC YEAR 1 ONLY - HARDCODED DATES" mobile/lib/widgets/kemetic_day_info.dart -n 2>/dev/null > /dev/null; then
  echo "✗ Obsolete Year-1-only day-card banner found in mobile/lib/widgets/kemetic_day_info.dart"
  ISSUES=$((ISSUES + 1))
elif grep -R "Day cards are keyed by Kemetic month/day/decan and reused every year" mobile/lib/widgets/kemetic_day_info.dart -n 2>/dev/null > /dev/null \
    && grep -R "Gregorian labels in the UI come from \\[KemeticDayData.calculateGregorianDate\\]" mobile/lib/widgets/kemetic_day_info.dart -n 2>/dev/null > /dev/null; then
  echo "✓ Year-agnostic day-card invariant found"
else
  echo "✗ Year-agnostic day-card invariant missing from mobile/lib/widgets/kemetic_day_info.dart"
  ISSUES=$((ISSUES + 1))
fi
echo ""

# Ensure the leap drift comment is present:
echo "Checking for leap drift comment in kemetic_converter.dart..."
if grep -R "LEAP LOGIC & NEW-YEAR DRIFT" mobile/lib/core/kemetic_converter.dart -n 2>/dev/null > /dev/null; then
  echo "✓ Leap drift comment found"
else
  echo "✗ Leap drift comment missing from mobile/lib/core/kemetic_converter.dart"
  ISSUES=$((ISSUES + 1))
fi
echo ""

# Summary
echo "═══════════════════════════════════════"
if [ $ISSUES -eq 0 ]; then
  echo "✅ ALL CHECKS PASSED - Ready to commit!"
  echo "═══════════════════════════════════════"
  exit 0
else
  echo "❌ FOUND $ISSUES ISSUE(S) - Fix before committing"
  echo "═══════════════════════════════════════"
  exit 1
fi
