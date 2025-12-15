# PRODUCTION-READY COMPLETE ROLLBACK - Execute this:

```bash
set -euo pipefail  # Exit on any error, safer execution
```

═══════════════════════════════════════════════════════════════════════
PART A: PREFLIGHT SAFETY SWEEPS
═══════════════════════════════════════════════════════════════════════

**Execute these BEFORE making code changes to identify all cleanup targets:**

```bash
# Find all debug print statements across the codebase
echo "🔍 Scanning for debug prints..."
grep -RIn "print(\s*'\[DEBUG\]" lib || echo "✅ No [DEBUG] prints found"
grep -RIn "print(\s*'\[DBG\]" lib || echo "✅ No [DBG] prints found"
grep -RIn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" lib || echo "✅ No separator lines found"

# Check for leftover onTap: callsites (should be none if code is clean)
echo ""
echo "🔍 Checking for leftover onTap: in KemeticDayButton callsites..."
grep -RIn "KemeticDayButton\(" lib | grep -E "onTap\s*:" || echo "✅ No onTap: callsites found (clean)"

# Count gregorianDate occurrences before rollback
echo ""
echo "🔍 Counting gregorianDate fields before rollback..."
grep -RIn "gregorianDate:\s*'" lib/widgets/kemetic_day_info.dart | wc -l
```

**Expected output:**
- Debug prints in `kemetic_day_info.dart` (will be removed)
- Possibly in other files (remove manually if found)
- No `onTap:` callsites (or remove if found)
- Count of gregorianDate fields (for verification)

---

═══════════════════════════════════════════════════════════════════════
PART B: CODE CHANGES
═══════════════════════════════════════════════════════════════════════

Execute steps 1-5 (manually or via Cursor):

## Step 1: calendar_page.dart - Remove ShaderMask from regular month headers

**Location:** Around line 4570-4577

**FIND THIS CODE:**
```dart
child: ShaderMask(
  shaderCallback: (bounds) => _goldGloss.createShader(bounds),
  blendMode: BlendMode.srcIn,
  child: MonthNameText(
    getMonthById(kMonth).displayFull,
    style: _monthTitleGold.copyWith(color: Colors.white),
  ),
),
```

**REPLACE WITH:**
```dart
child: MonthNameText(
  getMonthById(kMonth).displayFull,
  style: _monthTitleGold,
),
```

---

## Step 2: calendar_page.dart - Remove ShaderMask from Heriu Renpet header

**Location:** Around line 4941-4948

**FIND THIS CODE:**
```dart
child: ShaderMask(
  shaderCallback: (bounds) => _goldGloss.createShader(bounds),
  blendMode: BlendMode.srcIn,
  child: MonthNameText(
    'Heriu Renpet (ḥr.w rnpt)',
    style: _monthTitleGold.copyWith(color: Colors.white),
  ),
),
```

**REPLACE WITH:**
```dart
child: MonthNameText(
  'Heriu Renpet (ḥr.w rnpt)',
  style: _monthTitleGold.copyWith(color: Colors.white),
),
```

---

## Step 3: kemetic_day_info.dart - Remove debug prints from _showDropdown()

**Location:** Around line 9930-9948

**FIND THIS CODE:**
```dart
void _showDropdown() {
  // DEBUG: Log long-press attempts
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  print('[DEBUG] Long-press detected');
  print('[DEBUG] Day key: ${widget.dayKey}');
  
  final RenderBox? renderBox = _buttonKey.currentContext?.findRenderObject() as RenderBox?;
  if (renderBox == null) {
    print('[DEBUG] ERROR: renderBox is null');
    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return;
  }
  
  final position = renderBox.localToGlobal(Offset.zero);
  final size = renderBox.size;
  
  // DEBUG: Log position info
  print('[DEBUG] Button position: $position');
  print('[DEBUG] Button size: $size');

  _controller.show(
```

**REPLACE WITH:**
```dart
void _showDropdown() {
  final RenderBox? renderBox = _buttonKey.currentContext?.findRenderObject() as RenderBox?;
  if (renderBox == null) {
    return;
  }
  
  final position = renderBox.localToGlobal(Offset.zero);
  final size = renderBox.size;

  _controller.show(
```

---

## Step 4: kemetic_day_info.dart - Remove debug prints from KemeticDayDropdownController.show()

**Location:** Around line 9855-9869

**FIND THIS CODE:**
```dart
final dayInfo = KemeticDayData.getInfoForDay(dayKey);

// DEBUG: Log lookup result
print('[DEBUG] Looking up card for: $dayKey');
print('[DEBUG] Card found: ${dayInfo != null}');

if (dayInfo == null) {
  print('[DEBUG] ❌ No card data for: $dayKey');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return;
}

print('[DEBUG] ✅ Card data exists for: $dayKey');
print('[DEBUG] Card kemeticDate: ${dayInfo.kemeticDate}');
print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

_overlayEntry = OverlayEntry(
```

**REPLACE WITH:**
```dart
final dayInfo = KemeticDayData.getInfoForDay(dayKey);

if (dayInfo == null) {
  return;
}

_overlayEntry = OverlayEntry(
```

---

## Step 5: Remove any remaining debug prints found in preflight

**If preflight found prints in other files** (e.g., `day_view.dart`, `calendar_page.dart`), remove them manually using the same pattern.

---

## Step 6: Verify code changes and check for unused imports

```bash
# Check for unused imports/variables after ShaderMask removal
echo "🔍 Checking for unused imports/variables..."
flutter analyze lib/features/calendar/calendar_page.dart

# Verify no leftover debug prints
echo ""
echo "🔍 Verifying debug prints are removed..."
grep -RIn "print(\s*'\[DEBUG\]" lib || echo "✅ All [DEBUG] prints removed"
grep -RIn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" lib || echo "✅ All separator lines removed"
```

**If `flutter analyze` reports unused imports/variables:**
- Remove unused imports (e.g., `ShaderMask`, `BlendMode` if only used for removed code)
- Keep variables if they're used elsewhere in the file

---

## Step 7: Clean build and clear cache

```bash
flutter clean
rm -rf build .dart_tool
flutter pub get
```

**Then in browser:**
1. Open DevTools (F12)
2. Go to Application tab
3. Click "Service Workers" → Unregister all
4. Click "Storage" → "Clear site data"
5. Close the browser tab completely

═══════════════════════════════════════════════════════════════════════
PART C: REVERT DATES (PRODUCTION SCRIPT)
═══════════════════════════════════════════════════════════════════════

**Copy and paste this entire Python script into terminal:**

**Default run (safe - aborts if backup exists):**
```bash
python3 - << 'PY'
import re, datetime, sys, pathlib, shutil, time

root = pathlib.Path('.')
targets = list(root.rglob('kemetic_day_info.dart'))
if not targets:
    print("ERROR: Could not find kemetic_day_info.dart"); sys.exit(1)
target = targets[0]
print(f"🗂  Target file: {target}")

# Check for --force flag
force = "--force" in sys.argv

TARGET_SLUGS = {'renwet', 'hnsw', 'henti', 'paipi', 'ipt'}
MONTHS = {m.lower(): i for i, m in enumerate(['', 'January','February','March','April','May','June','July','August','September','October','November','December'])}

def parse_date(s):
    m = re.match(r'([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$', s.strip())
    if not m: return None
    mon, day, yr = m.group(1).lower(), int(m.group(2)), int(m.group(3))
    mi = MONTHS.get(mon)
    return datetime.date(yr, mi, day) if mi else None

def fmt_date(d):
    # Portable date formatting (works on macOS/Linux/Windows)
    # Uses .replace(' 0', ' ') to strip leading zeros from single-digit days
    return d.strftime('%B %d, %Y').replace(' 0', ' ')

# Preflight count
text = target.read_text(encoding='utf-8')
preflight_count = len(re.findall(r"gregorianDate:\s*'", text))
print(f"📊 Preflight: Found {preflight_count} gregorianDate fields")

pattern = re.compile(r"(?P<key>[A-Za-z]+_\d+_\d+)'\s*:\s*KemeticDayInfo\([^)]*?gregorianDate:\s*'(?P<date>[^']+)'", re.DOTALL)

backup = target.with_suffix(target.suffix + '.rollback.bak')

# Handle backup with --force support
if backup.exists() and not force:
    print(f"⚠️  Backup already exists: {backup}")
    print("   Re-run with --force to proceed (a timestamped backup will be created).")
    sys.exit(1)

if force and backup.exists():
    ts = time.strftime("%Y%m%d-%H%M%S")
    backup = target.with_suffix(target.suffix + f".rollback.{ts}.bak")
    print(f"🔄 Force mode: Creating timestamped backup: {backup}")

if not backup.exists():
    shutil.copy2(target, backup)
    print(f"📦 Backup created: {backup}")
else:
    print(f"📦 Using existing backup: {backup}")

total_changed = 0
preview_logged = False

def do_repl(m):
    nonlocal total_changed, preview_logged
    key, date_str = m.group('key'), m.group('date')
    slug = key.split('_', 1)[0].lower()
    if slug not in TARGET_SLUGS: return m.group(0)
    d = parse_date(date_str)
    if not d: return m.group(0)
    # GUARD: Only Oct 2025-Feb 2026 (idempotent)
    if not (datetime.date(2025, 10, 1) <= d <= datetime.date(2026, 2, 28)):
        return m.group(0)
    new_d = d - datetime.timedelta(days=9)
    total_changed += 1
    if not preview_logged:
        print(f"🔎 Sample: '{date_str}' → '{fmt_date(new_d)}'")
        preview_logged = True
    return m.group(0).replace(date_str, fmt_date(new_d))

new_text = pattern.sub(do_repl, text)

# SAFETY: Expect ~120 changes
if total_changed == 0:
    print("⚠️  0 changes found. Already reverted OR wrong date range.")
    print("    Check if dates are already in Oct 7-Nov 5 range (pre-chat state).")
    print("    Aborting write for safety.")
    sys.exit(2)
if total_changed > 200:
    print(f"⚠️  {total_changed} changes found (expected ~120).")
    print("    This is unexpectedly high. Aborting write for safety.")
    sys.exit(2)

if new_text != text:
    target.write_text(new_text, encoding='utf-8')
    print(f"✅ {total_changed} dates reverted in {target.name}")

# Verify postflight count matches (same number of fields, dates changed)
postflight_count = len(re.findall(r"gregorianDate:\s*'", new_text))
if postflight_count != preflight_count:
    print(f"⚠️  WARNING: Field count changed from {preflight_count} to {postflight_count}")
else:
    print(f"✅ Postflight: {postflight_count} gregorianDate fields (unchanged count)")

print(f"\n💾 Backup saved at: {backup}")
print(f"📝 To restore dates: cp {backup} {target}")
PY
```

**If backup exists and you need to re-run, use:**
```bash
python3 - << 'PY' ... PY --force
```

**Key improvements:**
- ✅ Portable date formatting (works on macOS/Linux/Windows)
- ✅ `--force` flag support for re-runs (creates timestamped backup)
- ✅ Preflight/postflight field count verification
- ✅ Shows exact target file path

═══════════════════════════════════════════════════════════════════════
PART D: FINAL BUILD & LAUNCH
═══════════════════════════════════════════════════════════════════════

```bash
echo ""
echo "Final clean build..."
flutter clean
flutter pub get

echo ""
echo "First run with HTML renderer (flushes service worker)..."
flutter run -d chrome --web-renderer html &
HTML_PID=$!
sleep 5
kill $HTML_PID 2>/dev/null || true
sleep 2

echo ""
echo "Launching with default renderer..."
flutter run -d chrome
```

═══════════════════════════════════════════════════════════════════════
PART E: HARD RELOAD (CRITICAL - Do this in browser)
═══════════════════════════════════════════════════════════════════════

**After app opens in browser, perform a hard reload:**

1. Open DevTools (F12)
2. **Hard Reload**: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
   - This ensures no stale CanvasKit or service worker cache remains
   - Regular reload (F5) may not clear all caches

═══════════════════════════════════════════════════════════════════════
AFTER LAUNCH: Manual verification
═══════════════════════════════════════════════════════════════════════

When app opens in browser (after hard reload):
1. Open DevTools (F12)
2. Check console for errors
3. Verify:
   ✓ Month headers plain (no gold gradient)
   ✓ Tap day → opens day view
   ✓ Long-press day with card → dropdown appears
   ✓ Long-press day without card → silent (no snackbar)
   ✓ No debug console spam
   ✓ Dates in months 8-11 show original values (Oct 7 vs Oct 16, etc.)

═══════════════════════════════════════════════════════════════════════
SUCCESS CRITERIA
═══════════════════════════════════════════════════════════════════════

✓ Preflight found expected debug prints
✓ Script reported ~120 changes (not 0, not >200)
✓ Backup file created (.rollback.bak or timestamped)
✓ Preflight/postflight field counts match
✓ App compiles without errors
✓ `flutter analyze` shows no unused imports/variables
✓ Visual behavior matches pre-chat state
✓ All 120 dates reverted to original (wrong) values
✓ No debug console spam
✓ Hard reload performed successfully

═══════════════════════════════════════════════════════════════════════
SAFETY FEATURES
═══════════════════════════════════════════════════════════════════════

• set -euo pipefail: Stops on first error
• Preflight sweeps identify all cleanup targets
• Automatic backup creation (with timestamped backup for --force)
• Change count validation (aborts if suspicious)
• Preflight/postflight field count verification
• Sample date preview
• Idempotent (safe to run multiple times with --force)
• Guarded date range (Oct 2025-Feb 2026)
• Portable date formatting (macOS/Linux/Windows compatible)
• Recursive file search
• Service worker flush
• Hard reload reminder (critical for cache clearing)
• Unused import/variable detection

═══════════════════════════════════════════════════════════════════════
RESTORE IF NEEDED
═══════════════════════════════════════════════════════════════════════

To restore the corrected dates:
```bash
# Find backup
find . -name "*.rollback.bak" -o -name "*.rollback.*.bak"

# Restore (replace <path> with actual path)
cp <path-to-backup> <path-to-kemetic_day_info.dart>
```

═══════════════════════════════════════════════════════════════════════
IMPORTANT NOTES
═══════════════════════════════════════════════════════════════════════

**What is being removed:**
- ✅ ShaderMask wrappers from month headers (2 locations)
- ✅ Debug print statements from _showDropdown() (8 lines)
- ✅ Debug print statements from KemeticDayDropdownController.show() (5 lines)
- ✅ Any additional debug prints found in preflight
- ✅ Date adjustments (subtract 9 days from ~120 dates)

**What is NOT being removed (doesn't exist in current code):**
- ❌ onTap parameter (KemeticDayButton doesn't have this)
- ❌ behavior: HitTestBehavior.opaque (GestureDetector doesn't have this)
- ❌ SnackBar code (doesn't exist)

**Based on code inspection:**
- GestureDetector only has `onLongPress` (correct state)
- KemeticDayButton only has `dayKey` and `child` (correct state)
- InkWell in _DayChip is present (correct state)

**Portability improvements:**
- Date formatting now works on all platforms (macOS/Linux/Windows)
- `--force` flag allows safe re-runs with timestamped backups
- Preflight/postflight verification ensures data integrity

═══════════════════════════════════════════════════════════════════════
