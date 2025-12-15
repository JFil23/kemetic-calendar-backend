-- Step 1.5: User Profiles + Flow Sharing + Unified Inbox
-- Database Migration for Sharing System

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table (if not exists)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  handle TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  location TEXT,
  is_discoverable BOOLEAN DEFAULT true,
  allow_incoming_shares BOOLEAN DEFAULT true,
  active_flows_count INTEGER DEFAULT 0,
  total_flow_events_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create flow_shares table
CREATE TABLE IF NOT EXISTS flow_shares (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  flow_id INTEGER NOT NULL,
  flow_title TEXT NOT NULL,
  sender_id UUID REFERENCES profiles(id) NOT NULL,
  recipient_id UUID REFERENCES profiles(id),
  recipient_email TEXT,
  suggested_schedule JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'imported', 'public')),
  viewed_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create event_shares table
CREATE TABLE IF NOT EXISTS event_shares (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id INTEGER NOT NULL,
  event_title TEXT NOT NULL,
  sender_id UUID REFERENCES profiles(id) NOT NULL,
  recipient_id UUID REFERENCES profiles(id),
  recipient_email TEXT,
  event_date TIMESTAMPTZ,
  suggested_schedule JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'imported', 'public')),
  viewed_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create short_links table for public sharing
CREATE TABLE IF NOT EXISTS short_links (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  short_id TEXT UNIQUE NOT NULL,
  share_id UUID NOT NULL,
  share_type TEXT NOT NULL CHECK (share_type IN ('flow', 'event')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle);
CREATE INDEX IF NOT EXISTS idx_profiles_discoverable ON profiles(is_discoverable) WHERE is_discoverable = true;
CREATE INDEX IF NOT EXISTS idx_flow_shares_recipient ON flow_shares(recipient_id);
CREATE INDEX IF NOT EXISTS idx_flow_shares_sender ON flow_shares(sender_id);
CREATE INDEX IF NOT EXISTS idx_flow_shares_status ON flow_shares(status);
CREATE INDEX IF NOT EXISTS idx_event_shares_recipient ON event_shares(recipient_id);
CREATE INDEX IF NOT EXISTS idx_event_shares_sender ON event_shares(sender_id);
CREATE INDEX IF NOT EXISTS idx_event_shares_status ON event_shares(status);
CREATE INDEX IF NOT EXISTS idx_short_links_short_id ON short_links(short_id);
CREATE INDEX IF NOT EXISTS idx_short_links_share_id ON short_links(share_id);

-- Create views for inbox functionality
CREATE OR REPLACE VIEW inbox_share_items_filtered AS
SELECT 
  fs.id as share_id,
  'flow_share' as kind,
  fs.recipient_id,
  fs.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  fs.flow_id as payload_id,
  fs.flow_title as title,
  fs.created_at,
  fs.viewed_at,
  fs.imported_at,
  fs.suggested_schedule,
  NULL as event_date,
  NULL as payload_json
FROM flow_shares fs
JOIN profiles s ON fs.sender_id = s.id
WHERE fs.recipient_id IS NOT NULL
  AND fs.status IN ('sent', 'viewed', 'imported')

UNION ALL

SELECT 
  es.id as share_id,
  'event_share' as kind,
  es.recipient_id,
  es.sender_id,
  s.handle as sender_handle,
  s.display_name as sender_name,
  s.avatar_url as sender_avatar,
  es.event_id as payload_id,
  es.event_title as title,
  es.created_at,
  es.viewed_at,
  es.imported_at,
  es.suggested_schedule,
  es.event_date,
  NULL as payload_json
FROM event_shares es
JOIN profiles s ON es.sender_id = s.id
WHERE es.recipient_id IS NOT NULL
  AND es.status IN ('sent', 'viewed', 'imported');

-- Create view for unread count
CREATE OR REPLACE VIEW inbox_unread_count_filtered AS
SELECT 
  recipient_id,
  COUNT(*) as unread_count
FROM inbox_share_items_filtered
WHERE viewed_at IS NULL
GROUP BY recipient_id;

-- Create RLS policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view discoverable profiles" ON profiles
  FOR SELECT USING (is_discoverable = true);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Flow shares policies
CREATE POLICY "Users can view shares sent to them" ON flow_shares
  FOR SELECT USING (auth.uid() = recipient_id);

CREATE POLICY "Users can view shares they sent" ON flow_shares
  FOR SELECT USING (auth.uid() = sender_id);

CREATE POLICY "Users can create shares" ON flow_shares
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update shares they sent" ON flow_shares
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE POLICY "Users can update shares sent to them" ON flow_shares
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Event shares policies
CREATE POLICY "Users can view event shares sent to them" ON event_shares
  FOR SELECT USING (auth.uid() = recipient_id);

CREATE POLICY "Users can view event shares they sent" ON event_shares
  FOR SELECT USING (auth.uid() = sender_id);

CREATE POLICY "Users can create event shares" ON event_shares
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update event shares they sent" ON event_shares
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE POLICY "Users can update event shares sent to them" ON event_shares
  FOR UPDATE USING (auth.uid() = recipient_id);

-- Short links policies
CREATE POLICY "Anyone can view active short links" ON short_links
  FOR SELECT USING (expires_at IS NULL OR expires_at > NOW());

CREATE POLICY "Users can create short links" ON short_links
  FOR INSERT WITH CHECK (true);

-- Create triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_flow_shares_updated_at BEFORE UPDATE ON flow_shares
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_shares_updated_at BEFORE UPDATE ON event_shares
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default profile for existing users (if any)
INSERT INTO profiles (id, handle, display_name, is_discoverable, allow_incoming_shares)
SELECT 
  id,
  'user_' || substr(id::text, 1, 8),
  'User',
  true,
  true
FROM auth.users
WHERE id NOT IN (SELECT id FROM profiles)
ON CONFLICT (id) DO NOTHING;


