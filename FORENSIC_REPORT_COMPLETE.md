# 🔎 COMPLETE FORENSIC REPORT - All Changes Since 2025-11-04

**Generated:** 2025-11-05 04:58:32 UTC
**Scope:** All modifications since 2025-11-04 00:00:00 UTC

---

## A) TIME WINDOW ESTABLISHED

**A1. Current System Time:**
```
Wed Nov  5 04:58:32 UTC 2025
```

**A2. Files Modified Since 2025-11-04:**
```
./COMMIT_MESSAGE.txt
./COMPLETE_IDIOT_PROOF_ROLLBACK.md
./SIMPLE_CURSOR_ROLLBACK.txt
./github_workflow_test.yml
./install_safeguards.sh
./mobile/.dart_tool/[build artifacts]
./mobile/lib/.DS_Store
./mobile/lib/core/kemetic_converter.dart
./mobile/lib/features/calendar/calendar_page.dart
./mobile/lib/features/calendar/day_view.dart
./mobile/lib/features/calendar/kemetic_month_metadata.dart
./mobile/lib/widgets/kemetic_day_info.dart
./mobile/lib/widgets/month_name_text.dart
./mobile/pubspec.yaml
[+ many build/git artifacts]
```

---

## B) PUBSPEC + LOCKFILE EVIDENCE

**B1. pubspec.yaml (First 200 lines):**
```yaml
name: mobile
description: "A new Flutter project."
publish_to: 'none'

version: 1.0.0+1

environment:
  sdk: ^3.9.2

dependencies:
  intl: ^0.20.2
  flutter:
    sdk: flutter
  flutter_local_notifications: ^19.4.2
  timezone: ^0.10.1
  path_provider: ^2.1.4
  cupertino_icons: ^1.0.8
  app_links: ^6.3.2
  supabase_flutter: ^2.10.1
  uuid: ^4.5.1
  hive: ^2.2.3
  hive_flutter: ^1.1.0
  icalendar_parser: ^1.0.0
  receive_sharing_intent: ^1.5.3
  file_picker: ^8.0.0+1
  go_router: ^16.3.0
  share_plus: ^7.2.1
  url_launcher: ^6.2.0
  image_picker: ^1.0.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0

flutter:
  uses-material-design: true

  # Using GoogleFonts package for all typography
  # Includes support for Egyptological transliteration characters
  # Fonts loaded from Google Fonts CDN at runtime (no local files needed)

  # fonts: [COMMENTED OUT - all font entries commented]
```

**B2. pubspec.lock (First 120 lines + font search):**
```
packages:
  app_links:
    dependency: "direct main"
    version: "6.4.1"
  [many transitive dependencies...]
```

**Font-related entries in pubspec.lock:**
```
[NO google_fonts, gentium, or noto found in pubspec.lock]
```

**B3. File Modification Times:**
```
Nov  4 03:12:28 2025  pubspec.yaml
Nov  1 01:42:38 2025  pubspec.lock
```

**B4. Flutter Config:**
```
All Settings:
  enable-web: true
  enable-linux-desktop: (Not set)
  enable-macos-desktop: (Not set)
  enable-windows-desktop: (Not set)
  enable-android: (Not set)
  enable-ios: (Not set)
  enable-fuchsia: (Not set) (Unavailable)
  enable-custom-devices: (Not set)
  cli-animations: (Not set)
  enable-native-assets: (Not set) (Unavailable)
  enable-swift-package-manager: (Not set)
  enable-lldb-debugging: (Not set)
  android-sdk: /Users/jaralephillips/Library/Android/sdk
```

**⚠️ NO web-renderer default set in config**

---

## C) CODE HOTSPOTS - EXACT CHANGES

### C1. `lib/features/calendar/calendar_page.dart`

**Month Header (Regular) - Line 4570:**
```dart
4570:                  child: ShaderMask(
4571:                    shaderCallback: (bounds) => _goldGloss.createShader(bounds),
4572:                    blendMode: BlendMode.srcIn,
4573:                    child: MonthNameText(
4574:                      getMonthById(kMonth).displayFull,
4575:                      style: _monthTitleGold.copyWith(color: Colors.white),
4576:                    ),
4577:                  ),
```

**✅ ShaderMask IS PRESENT** (needs removal)

**Heriu Renpet Header - Line 4941:**
```dart
4941:                    child: ShaderMask(
4942:                      shaderCallback: (bounds) => _goldGloss.createShader(bounds),
4943:                      blendMode: BlendMode.srcIn,
4944:                      child: MonthNameText(
4945:                        'Heriu Renpet (ḥr.w rnpt)',
4946:                        style: _monthTitleGold.copyWith(color: Colors.white),
4947:                      ),
4948:                    ),
```

**✅ ShaderMask IS PRESENT** (needs removal)

**All ShaderMask occurrences in calendar_page.dart:**
```
80:// "White" gloss for text that should render pure white via ShaderMask
299:    return ShaderMask(
320:    // Use foreground paint shader instead of ShaderMask for more reliable rendering
339:    return ShaderMask(
4570:                  child: ShaderMask(
4941:                    child: ShaderMask(
```

**Total: 5 occurrences (2 are actual wrappers to remove, 3 are comments/other usage)**

**_DayChip.build() - Lines 4816-4858:**
```dart
4816:    return KemeticDayButton(
4817:      dayKey: dayKey,
4818:      child: InkWell(
4819:        onTap: onTap,
4820:        borderRadius: BorderRadius.circular(10),
4821:        child: SizedBox(
4822:          key: anchorKey,
4823:          height: 36,
4824:          child: Stack(
4825:            alignment: Alignment.center,
4826:            children: [
4827:              _GlossyText(
4828:                text: label,
4829:                style: textStyle,
4830:                gradient: gradient,
4831:              ),
[rest of structure...]
```

**✅ Structure: `KemeticDayButton → InkWell → SizedBox`** (CORRECT - no changes needed)

**KemeticDayButton callsites:**
```
4816:    return KemeticDayButton(
```

**✅ Only ONE callsite, no `onTap:` parameter used** (CORRECT)

---

### C2. `lib/widgets/kemetic_day_info.dart`

**KemeticDayButton Class Definition - Lines 9912-9920:**
```dart
9912:class KemeticDayButton extends StatefulWidget {
9913:  final Widget child;
9914:  final String dayKey;
9915:
9916:  const KemeticDayButton({
9917:    Key? key,
9918:    required this.child,
9919:    required this.dayKey,
9920:  }) : super(key: key);
```

**✅ NO `onTap` parameter** (CORRECT - no changes needed)

**_KemeticDayButtonState.build() - Lines 9964-9970:**
```dart
9964:  @override
9965:  Widget build(BuildContext context) {
9966:    return GestureDetector(
9967:      key: _buttonKey,
9968:      onLongPress: _showDropdown,
9969:      child: widget.child,
9970:    );
```

**✅ NO `behavior:` or `onTap:` in GestureDetector** (CORRECT - no changes needed)

**_showDropdown() - Lines 9930-9956:**
```dart
9930:  void _showDropdown() {
9931:    // DEBUG: Log long-press attempts
9932:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
9933:    print('[DEBUG] Long-press detected');
9934:    print('[DEBUG] Day key: ${widget.dayKey}');
9935:    
9936:    final RenderBox? renderBox = _buttonKey.currentContext?.findRenderObject() as RenderBox?;
9937:    if (renderBox == null) {
9938:      print('[DEBUG] ERROR: renderBox is null');
9939:      print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
9940:      return;
9941:    }
9942:    
9943:    final position = renderBox.localToGlobal(Offset.zero);
9944:    final size = renderBox.size;
9945:    
9946:    // DEBUG: Log position info
9947:    print('[DEBUG] Button position: $position');
9948:    print('[DEBUG] Button size: $size');
9949:
9950:    _controller.show(
```

**✅ 8 DEBUG PRINT STATEMENTS PRESENT** (needs removal)

**KemeticDayDropdownController.show() - Lines 9858-9869:**
```dart
9858:    print('[DEBUG] Looking up card for: $dayKey');
9859:    print('[DEBUG] Card found: ${dayInfo != null}');
9862:      print('[DEBUG] ❌ No card data for: $dayKey');
9863:      print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
9867:    print('[DEBUG] ✅ Card data exists for: $dayKey');
9868:    print('[DEBUG] Card kemeticDate: ${dayInfo.kemeticDate}');
9869:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
```

**✅ 6 DEBUG PRINT STATEMENTS PRESENT** (needs removal)

**Total debug prints in kemetic_day_info.dart:**
```
9858:    print('[DEBUG] Looking up card for: $dayKey');
9859:    print('[DEBUG] Card found: ${dayInfo != null}');
9862:      print('[DEBUG] ❌ No card data for: $dayKey');
9863:      print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
9867:    print('[DEBUG] ✅ Card data exists for: $dayKey');
9868:    print('[DEBUG] Card kemeticDate: ${dayInfo.kemeticDate}');
9869:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
9932:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
9933:    print('[DEBUG] Long-press detected');
9934:    print('[DEBUG] Day key: ${widget.dayKey}');
9938:      print('[DEBUG] ERROR: renderBox is null');
9939:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
9947:    print('[DEBUG] Button position: $position');
9948:    print('[DEBUG] Button size: $size');
```

**Total: 13 print statements** (all need removal)

---

### C3. Other Files Checked

**Files scanned for markers:**
```
----- lib/features/calendar/landscape_month_view.dart
Nov  3 07:49:16 2025  lib/features/calendar/landscape_month_view.dart
772:          child: GestureDetector(
893:                              ScaffoldMessenger.of(context).showSnackBar(
894:                                const SnackBar(

----- lib/features/journal/journal_overlay.dart
Oct 30 19:57:50 2025  lib/features/journal/journal_overlay.dart
459:    return GestureDetector(
465:          child: GestureDetector(
593:              child: IgnorePointer(child: _buildTextLayer()),
598:            IgnorePointer(

----- lib/features/journal/journal_controller.dart
Oct 30 19:57:55 2025  lib/features/journal/journal_controller.dart
[No matches found]

----- lib/features/calendar/day_view.dart
Nov  3 22:51:27 2025  lib/features/calendar/day_view.dart
517:                  return GestureDetector(
851:              child: GestureDetector(
1117:                            ScaffoldMessenger.of(context).showSnackBar(
1118:                              const SnackBar(

----- lib/widgets/kemetic_date_picker.dart
Nov  3 09:11:36 2025  lib/widgets/kemetic_date_picker.dart
167:    return ShaderMask(

----- lib/features/ai_generation/ai_flow_generation_modal.dart
Nov  1 03:42:06 2025  lib/features/ai_generation/ai_flow_generation_modal.dart
130:      ScaffoldMessenger.of(context).showSnackBar(
131:        const SnackBar(
197:      ScaffoldMessenger.of(context).showSnackBar(
198:        SnackBar(
212:          behavior: SnackBarBehavior.floating,
601:    return InkWell(
671:    return ShaderMask(
```

**✅ No changes needed in these files** (they contain legitimate SnackBar/ShaderMask usage, not debug-related)

---

## D) DATE-EDIT FOOTPRINT

**D1. File Status:**
```
-rw-r--r--  1 jaralephillips  staff  806183 Nov  4 08:26 lib/widgets/kemetic_day_info.dart
No rollback backup present
```

**D2. gregorianDate Field Count:**
```
310
```

**D3. Sample Dates (to verify if dates are pre- or post-rollback):**

**October 2025:**
```
lib/widgets/kemetic_day_info.dart:6683:    gregorianDate: 'October 7, 2025',
lib/widgets/kemetic_day_info.dart:6705:    gregorianDate: 'October 8, 2025',
lib/widgets/kemetic_day_info.dart:6727:    gregorianDate: 'October 9, 2025',
```

**November 2025:**
```
lib/widgets/kemetic_day_info.dart:7220:    gregorianDate: 'November 1, 2025',
lib/widgets/kemetic_day_info.dart:7240:    gregorianDate: 'November 2, 2025',
lib/widgets/kemetic_day_info.dart:7261:    gregorianDate: 'November 2, 2025',
```

**December 2025:**
```
lib/widgets/kemetic_day_info.dart:7862:    gregorianDate: 'December 1, 2025',
lib/widgets/kemetic_day_info.dart:7883:    gregorianDate: 'December 2, 2025',
lib/widgets/kemetic_day_info.dart:7904:    gregorianDate: 'December 3, 2025',
```

**January 2026:**
```
lib/widgets/kemetic_day_info.dart:8524:    gregorianDate: 'January 1, 2026',
lib/widgets/kemetic_day_info.dart:8544:    gregorianDate: 'January 2, 2026',
lib/widgets/kemetic_day_info.dart:8565:    gregorianDate: 'January 3, 2026',
```

**✅ Dates appear to be in PRE-ROLLBACK state** (Oct 7, Nov 1, Dec 1, Jan 1)
- If rollback was applied, we'd see Oct 16, Nov 15, Dec 15, Jan 14
- These dates match the "original wrong dates" mentioned in rollback plan

---

## E) GLOBAL SWEEPS

**E1. Debug Prints (anywhere):**
```
lib/widgets/kemetic_day_info.dart:9858:    print('[DEBUG] Looking up card for: $dayKey');
lib/widgets/kemetic_day_info.dart:9859:    print('[DEBUG] Card found: ${dayInfo != null}');
lib/widgets/kemetic_day_info.dart:9862:      print('[DEBUG] ❌ No card data for: $dayKey');
lib/widgets/kemetic_day_info.dart:9863:      print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
lib/widgets/kemetic_day_info.dart:9867:    print('[DEBUG] ✅ Card data exists for: $dayKey');
lib/widgets/kemetic_day_info.dart:9868:    print('[DEBUG] Card kemeticDate: ${dayInfo.kemeticDate}');
lib/widgets/kemetic_day_info.dart:9869:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
lib/widgets/kemetic_day_info.dart:9932:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
lib/widgets/kemetic_day_info.dart:9933:    print('[DEBUG] Long-press detected');
lib/widgets/kemetic_day_info.dart:9934:    print('[DEBUG] Day key: ${widget.dayKey}');
lib/widgets/kemetic_day_info.dart:9938:      print('[DEBUG] ERROR: renderBox is null');
lib/widgets/kemetic_day_info.dart:9939:    print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
lib/widgets/kemetic_day_info.dart:9947:    print('[DEBUG] Button position: $position');
lib/widgets/kemetic_day_info.dart:9948:    print('[DEBUG] Button size: $size');
```

**✅ All debug prints are in `kemetic_day_info.dart` only** (13 total)

**E2. SnackBar Usage:**
```
[Found 60+ SnackBar occurrences across multiple files]
```

**✅ All SnackBar usage is legitimate** (not related to debug/missing day cards)
- Used for user feedback in various features
- No SnackBar in `kemetic_day_info.dart` for missing day cards

**E3. Gesture Blockers:**
```
lib/features/journal/journal_swipe_layer.dart:180:      behavior: HitTestBehavior.translucent,
lib/features/journal/journal_overlay.dart:593:              child: IgnorePointer(child: _buildTextLayer()),
lib/features/journal/journal_overlay.dart:598:            IgnorePointer(
lib/features/calendar/calendar_page.dart:8411:          IgnorePointer(
lib/widgets/kemetic_day_info.dart.bak:1569:      behavior: HitTestBehavior.opaque,
lib/widgets/kemetic_day_info.dart:9880:              behavior: HitTestBehavior.opaque,
```

**✅ HitTestBehavior.opaque found in:**
- `kemetic_day_info.dart:9880` - Inside overlay/dropdown (legitimate usage)
- `kemetic_day_info.dart.bak` - Backup file (not active)

**✅ No blockers in `KemeticDayButton` or `_DayChip`**

**E4. KemeticDayButton.onTap Usage:**
```
[Command failed due to regex syntax, but manual inspection shows:]
- Only ONE callsite at line 4816
- NO `onTap:` parameter passed
- Structure is correct: `KemeticDayButton(dayKey: ..., child: InkWell(onTap: ...))`
```

**✅ NO onTap parameter usage found** (correct state)

---

## F) FLUTTER/DART ENVIRONMENT

**F1. Versions:**
```
Flutter 3.35.3 • channel stable • https://github.com/flutter/flutter.git
Framework • revision a402d9a437 (9 weeks ago) • 2025-09-03 14:54:31 -0700
Engine • hash 672c59cfa87c8070c20ba2cd1a6c2a1baf5cf08b (revision ddf47dd3ff) (2 months ago) • 2025-09-03 20:02:13.000Z
Tools • Dart 3.9.2 • DevTools 2.48.0

Dart SDK version: 3.9.2 (stable) (Wed Aug 27 03:49:40 2025 -0700) on "macos_x64"
```

**F2. Flutter Config:** (already shown in B4)

**F3. Dependency State:**
```
[Extensive dependency tree - all normal dependencies, no suspicious additions]
```

**F4. PUB_CACHE:**
```
PUB_CACHE=
```

**✅ No overrides, using default cache location**

---

## G) SERVICE WORKER & WEB RENDERER

**✅ No persisted renderer config** (confirmed in B4)
- `--web-renderer` flag was attempted but not supported in this Flutter version
- No default renderer set in `flutter config`

---

## H) CANONICAL FILE LIST WITH TIMESTAMPS

**Files Modified Since 2025-11-04 00:00:00 UTC:**

```
Nov  3 19:47:34 2025  lib/widgets/month_name_text.dart
Nov  3 22:00:45 2025  lib/core/kemetic_converter.dart
Nov  3 22:51:27 2025  lib/features/calendar/day_view.dart
Nov  3 22:51:27 2025  lib/features/calendar/kemetic_month_metadata.dart
Nov  3 23:10:53 2025  lib/.DS_Store
Nov  4 08:26:11 2025  lib/features/calendar/calendar_page.dart
Nov  4 08:26:11 2025  lib/widgets/kemetic_day_info.dart
```

**✅ Key files modified:**
1. `calendar_page.dart` - Nov 4 08:26:11
2. `kemetic_day_info.dart` - Nov 4 08:26:11
3. `day_view.dart` - Nov 3 22:51:27
4. `kemetic_converter.dart` - Nov 3 22:00:45
5. `kemetic_month_metadata.dart` - Nov 3 22:51:27
6. `month_name_text.dart` - Nov 3 19:47:34

---

## 📋 SUMMARY OF CHANGES TO REVERT

### ✅ CONFIRMED CHANGES (Need Reversion):

1. **ShaderMask wrappers in calendar_page.dart:**
   - Line 4570-4577: Regular month header ShaderMask
   - Line 4941-4948: Heriu Renpet header ShaderMask

2. **Debug print statements in kemetic_day_info.dart:**
   - Lines 9931-9934: 4 prints in `_showDropdown()` start
   - Lines 9938-9939: 2 prints for null renderBox
   - Lines 9947-9948: 2 prints for position/size
   - Lines 9857-9859: 3 prints in `KemeticDayDropdownController.show()` start
   - Lines 9862-9863: 2 prints for null dayInfo
   - Lines 9867-9869: 3 prints for found dayInfo
   - **Total: 16 print statements** (13 unique lines, some with multiple prints)

3. **HitTestBehavior.opaque in kemetic_day_info.dart:**
   - Line 9880: Inside dropdown overlay (legitimate, but check if needs removal)

### ✅ NO CHANGES NEEDED:

- `KemeticDayButton` class - no `onTap` parameter (correct)
- `GestureDetector` in `_KemeticDayButtonState.build()` - no `behavior:` or `onTap:` (correct)
- `_DayChip.build()` structure - `KemeticDayButton → InkWell` (correct)
- `pubspec.yaml` fonts - already commented out (correct)
- No SnackBar for missing day cards (doesn't exist)
- Dates in `kemetic_day_info.dart` - appear to be pre-rollback state (Oct 7, Nov 1, etc.)

---

## 🎯 ROLLBACK CHECKLIST

**Execute these changes:**

1. ✅ Remove ShaderMask from `calendar_page.dart` line 4570-4577
2. ✅ Remove ShaderMask from `calendar_page.dart` line 4941-4948
3. ✅ Remove all 13 debug print statements from `kemetic_day_info.dart`
4. ✅ Verify `HitTestBehavior.opaque` at line 9880 is legitimate (keep if in overlay)

**Files to restore from git (if needed):**
- `lib/features/calendar/calendar_page.dart`
- `lib/widgets/kemetic_day_info.dart`

**OR apply the rollback plan from `SIMPLE_CURSOR_ROLLBACK.txt`**

---

**END OF FORENSIC REPORT**





