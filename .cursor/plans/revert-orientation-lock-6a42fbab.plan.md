<!-- 6a42fbab-c4e9-402e-83b1-61febab6de84 268ec747-c951-4356-8663-0b3dc97ff54b -->
# Fix Inbox NULL Handling Error

## Problem

The inbox is showing "No shares yet" with an error message:

```
[ShareRepo] Error fetching inbox items: type 'Null' is not a subtype of type 'String' in type cast
```

This happens because `ShareRepo.getInboxItems()` doesn't handle NULL values properly, while `InboxRepo.getShares()` does.

## Solution

Replace the method call on line 48 of `inbox_page.dart` to use the properly implemented `InboxRepo.getShares()` instead of `ShareRepo.getInboxItems()`.

## Changes Required

### File: mobile/lib/features/inbox/inbox_page.dart

**Line 48 - Change the method call:**

```dart
// BEFORE (line 48):
final items = await _shareRepo.getInboxItems();

// AFTER:
final items = await _inboxRepo.getShares();
```

**Explanation:** The `InboxRepo.getShares()` method has proper error handling and NULL-safe casting that was recently fixed, while `ShareRepo.getInboxItems()` still has the old implementation that crashes on NULL values.

## Why This Fixes It

1. `InboxRepo.getShares()` calls `InboxShareItem.fromJson()` which now has NULL-safe casting with fallbacks:

   - `sender_handle` defaults to `'unknown'` if NULL
   - `sender_name` defaults to `'Unknown User'` if NULL  
   - `payload_json` defaults to `{}` if NULL

2. The inbox page already has `_inboxRepo` initialized (line 26), so no additional setup is needed.

3. Both methods return the same type: `Future<List<InboxShareItem>>`, so no other code changes are required.

## Expected Result

After this fix:

- The inbox will load successfully even with NULL sender data
- The shared flow from the user will appear in the inbox
- The import button will work correctly
- No more NULL casting errors

### To-dos

- [ ] Create journal_schema.sql migration file
- [ ] Create ui_guards.dart and journal_repo.dart
- [ ] Create 4 journal feature files (constants, controller, overlay, swipe_layer)
- [ ] Create Phase 1.1 files (daily_review_handler, notify extension) - unintegrated
- [ ] Add imports and controller field to calendar_page.dart
- [ ] Add initialization in initState and disposal in dispose
- [ ] Extract _buildCalendarScrollView and wrap with JournalSwipeLayer
- [ ] Add UI guards to all navigation points in calendar_page.dart and day_view.dart
- [ ] Add journal tracking events to controller and swipe layer
- [ ] Run manual test checklist and smoke test