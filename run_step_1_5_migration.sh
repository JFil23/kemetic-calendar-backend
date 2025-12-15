#!/bin/bash

# Step 1.5 Database Migration Runner
# This script helps you run the sharing system database migration

echo "🚀 Step 1.5: User Profiles + Flow Sharing + Unified Inbox Migration"
echo "=================================================================="
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first:"
    echo "   macOS/Linux: brew install supabase/tap/supabase"
    echo "   Windows: scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase"
    echo ""
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# Check if user is logged in
if ! supabase projects list &> /dev/null; then
    echo "❌ Not logged in to Supabase. Please run:"
    echo "   supabase login"
    echo ""
    exit 1
fi

echo "✅ Logged in to Supabase"
echo ""

# Get project reference
echo "📋 Available projects:"
supabase projects list
echo ""

read -p "Enter your project reference: " PROJECT_REF

if [ -z "$PROJECT_REF" ]; then
    echo "❌ Project reference is required"
    exit 1
fi

echo ""
echo "🔗 Linking to project: $PROJECT_REF"
supabase link --project-ref $PROJECT_REF

if [ $? -ne 0 ]; then
    echo "❌ Failed to link to project"
    exit 1
fi

echo ""
echo "📊 Running database migration..."
echo "This will create:"
echo "  - profiles table"
echo "  - flow_shares table" 
echo "  - event_shares table"
echo "  - short_links table"
echo "  - RLS policies"
echo "  - Indexes and views"
echo ""

read -p "Continue? (y/N): " CONFIRM

if [[ $CONFIRM != [yY] ]]; then
    echo "❌ Migration cancelled"
    exit 1
fi

# Run the migration
supabase db push --include-all

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration completed successfully!"
    echo ""
    echo "🎉 Your sharing system is now ready!"
    echo ""
    echo "Next steps:"
    echo "1. Deploy Edge Functions:"
    echo "   supabase functions deploy create_flow_share"
    echo "   supabase functions deploy resolve_share"
    echo ""
    echo "2. Test the flow studio save button (it will now call the Edge Function)"
    echo ""
    echo "3. Configure deep links for iOS and Android"
    echo ""
else
    echo ""
    echo "❌ Migration failed. Check the error messages above."
    echo ""
    echo "Common issues:"
    echo "- Make sure you have the correct permissions"
    echo "- Check if tables already exist"
    echo "- Verify your project reference is correct"
    echo ""
fi


