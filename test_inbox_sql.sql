-- Test SQL for Inbox System
-- Run these queries in Supabase SQL Editor to test the inbox functionality

-- Step 1: Get your user ID and verify you have flows
SELECT 
  id as my_user_id, 
  handle, 
  display_name 
FROM profiles 
WHERE id = auth.uid();

-- Step 2: Get a flow ID to share (replace with your actual flow ID)
SELECT 
  id as flow_id, 
  name as flow_name,
  owner_id
FROM flows 
WHERE owner_id = auth.uid() 
LIMIT 1;

-- Step 3: Create a test share (replace the IDs below with values from above)
-- Replace 'YOUR_USER_ID' with your actual user ID from Step 1
-- Replace 'YOUR_FLOW_ID' with your actual flow ID from Step 2
INSERT INTO flow_shares (
  flow_id,
  sender_id,
  recipient_id,
  channel,
  suggested_schedule,
  created_at
) VALUES (
  1, -- Replace with your actual flow_id from Step 2
  auth.uid(), -- Your user ID
  auth.uid(), -- Same user for testing (sharing with yourself)
  'app',
  jsonb_build_object(
    'startDate', '2025-10-21',
    'weekdays', ARRAY[1,2,3,4,5],
    'everyOtherDay', false,
    'perWeek', null,
    'timesByWeekday', jsonb_build_object(
      '1', '09:00',
      '2', '09:00', 
      '3', '09:00',
      '4', '09:00',
      '5', '09:00'
    )
  ),
  now()
);

-- Step 4: Verify the share was created and appears in inbox
SELECT * FROM inbox_share_items_filtered WHERE recipient_id = auth.uid();

-- Step 5: Check unread count
SELECT * FROM inbox_unread_count_filtered WHERE recipient_id = auth.uid();

-- Step 6: Test marking as viewed
UPDATE flow_shares 
SET viewed_at = now() 
WHERE recipient_id = auth.uid() 
AND viewed_at IS NULL;

-- Step 7: Test marking as imported
UPDATE flow_shares 
SET imported_at = now() 
WHERE recipient_id = auth.uid() 
AND imported_at IS NULL;

-- Step 8: Clean up test data (run this when done testing)
-- DELETE FROM flow_shares WHERE recipient_id = auth.uid() AND sender_id = auth.uid();


