# Admin Dashboard - Cloud Backend Setup Guide

## What Changed

Your admin dashboard now connects to the **cloud backend** (Vercel Postgres database) instead of reading from Google Sheets directly. This means:

✅ **Live Updates**: Dashboard auto-refreshes every 30 seconds
✅ **Status Changes**: You can now update lead status directly from the dashboard
✅ **Real Database**: All data comes from and saves to your Vercel Postgres database
✅ **Google Sheets Sync**: Backend still syncs to Google Sheets when new leads are created

## Files Modified

1. **`admin-config.js`** (NEW) - API endpoint configuration
2. **`crm-service.js`** - Updated to call cloud API instead of localStorage
3. **`admin-dashboard.html`** - Updated to use cloud API with live polling

## Setup Instructions

### Option 1: Local Development (Testing)

If you want to test locally first:

1. **Start the CRM backend**:
   ```bash
   cd c:\Users\oblok\Desktop\Corexteriors\crm
   npm run dev
   ```
   This starts the backend at `http://localhost:3000`

2. **Open the admin dashboard**:
   - Open `admin-dashboard.html` in your browser
   - Login with password: `core2026`
   - The dashboard will automatically connect to `localhost:3000`

### Option 2: Production Deployment

To use the dashboard with your live Vercel deployment:

1. **Deploy your CRM to Vercel** (if not already deployed):
   ```bash
   cd c:\Users\oblok\Desktop\Corexteriors\crm
   vercel deploy --prod
   ```
   Note the deployment URL (e.g., `https://your-crm.vercel.app`)

2. **Update the API URL**:
   - Open `admin-config.js`
   - Find line 14: `return 'https://your-crm.vercel.app';`
   - Replace with your actual Vercel URL

3. **Test the dashboard**:
   - Open `admin-dashboard.html` in your browser
   - Login and verify leads are loading from the cloud

## Features

### Live Updates
- Dashboard automatically refreshes every 30 seconds
- No need to manually refresh the page
- See new leads as they come in

### Status Management
- Click any status dropdown to change a lead's status
- Changes save immediately to the database
- Status options: New, Quote Sent, Scheduled, Completed, Invoiced

### Error Handling
- If backend is unreachable, shows helpful error message
- Automatic retry with exponential backoff
- "Retry Connection" button to manually reconnect

## Troubleshooting

### "Failed to connect to CRM backend"

**Local Development:**
- Make sure the CRM backend is running: `cd crm && npm run dev`
- Check that it's running on port 3000
- Look for errors in the terminal

**Production:**
- Verify your Vercel deployment is live
- Check that the URL in `admin-config.js` is correct
- Ensure your database is set up (see `crm/SETUP_GUIDE.md`)

### Status changes not saving

- Check browser console for errors (F12)
- Verify the backend API is responding
- Make sure the database connection is working

### No leads showing

- Verify leads exist in the database
- Check that the API endpoint `/api/leads` is working
- Test the API directly: `https://your-url.vercel.app/api/leads`

## Next Steps

1. **Test locally** to make sure everything works
2. **Deploy to Vercel** when ready for production
3. **Update `admin-config.js`** with your production URL
4. **Share the admin dashboard** with your team

## Support

If you encounter issues:
1. Check the browser console (F12) for error messages
2. Check the CRM backend logs in Vercel dashboard
3. Verify your database is set up correctly
