# London Lead Finder

A web app to find contact information for commercial, strata, and apartment complexes in London, Ontario. Built for exterior maintenance companies to generate lead sheets.

## What it does

- **Searches** for apartment buildings, condos, commercial properties, and property management companies in London, ON
- **Collects** address, phone number, website, and building type for each property
- **Exports** results to CSV for use in your CRM or spreadsheets

**Note:** Google Places API does not provide email addresses. You can add emails manually in the app (editable table) or find them on each property's website. The website field links directly to the property site.

## Setup

### 1. Get a Google Places API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable **Places API (New)** — [direct link](https://console.cloud.google.com/apis/library/places-backend.googleapis.com)
4. Create credentials (API key) under **APIs & Services → Credentials**
5. Billing must be enabled (Google offers ~$200/month free credit; Places API usage is typically low for this use case)

### 2. Install and run

```bash
cd london-lead-finder
npm install
cp .env.example .env
# Edit .env and add your GOOGLE_PLACES_API_KEY
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Search and export

1. Click **Search London Properties**
2. Wait 1–2 minutes (the app fetches details for each property)
3. Optionally add emails manually in the table
4. Click **Export CSV** to download your lead sheet

## Data sources

- **Google Places API (New)** — Address, phone, website, building type
- **Ontario Condo Registry** — Not used here; the CAO registry prohibits automated access. For more condo data, consider [CAO Condo Registry Search](https://www.condoauthorityontario.ca/condo-registry-search/) for manual lookups.

## Cost estimate

Google Places API pricing (as of 2024):

- Text Search: ~$32 per 1000 requests
- Place Details: ~$17 per 1000 requests
- A typical run (80–100 properties) uses roughly 10–15 Text Search + 80–100 Place Details ≈ 90–115 requests
- Estimated cost per run: **~$2–3** (often covered by free tier)

## Google Sheets Integration (Optional)

Automatically sync your leads to a Google Sheet for easy sharing and collaboration!

### Setup Steps

#### 1. Create a Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Navigate to **APIs & Services → Credentials**
4. Click **+ CREATE CREDENTIALS** → **Service Account**
5. Enter a name (e.g., "Lead Finder Bot") and click **CREATE**
6. Skip role assignment (click **CONTINUE** then **DONE**)
7. Click on your newly created service account
8. Go to the **KEYS** tab → **ADD KEY** → **Create new key**
9. Choose **JSON** format and click **CREATE**
10. A JSON file will download — save it as `service-account-key.json` in your project folder

#### 2. Enable Google Sheets API

1. In Google Cloud Console, go to **APIs & Services → Library**
2. Search for "Google Sheets API"
3. Click **ENABLE**

#### 3. Create and Share Your Google Sheet

1. Create a new Google Sheet at [sheets.google.com](https://sheets.google.com)
2. Open the downloaded `service-account-key.json` and find the `client_email` field
   - It looks like: `lead-finder-bot@your-project.iam.gserviceaccount.com`
3. Share your Google Sheet with this email address (Editor access)
4. Copy the Sheet ID from the URL:
   - URL: `https://docs.google.com/spreadsheets/d/`**`1a2b3c4d5e6f...`**`/edit`
   - The bold part is your Sheet ID

#### 4. Configure the App

Update your `.env` file:

```env
GOOGLE_SHEETS_CREDENTIALS=./service-account-key.json
GOOGLE_SHEET_ID=your_sheet_id_from_step_3
AUTO_SYNC_SHEETS=true
```

Restart the server:

```bash
npm start
```

#### 5. Use Google Sheets Sync

- **Auto-sync**: Leads automatically sync to Google Sheets after each search
- **Manual sync**: Click "📊 Sync to Sheets" button in the app
- **Configure**: Click "⚙️ Sheets Config" to change settings

Your Google Sheet will automatically update with columns:
- Name, Address, Phone, Email, Website, Type, Replied, Notes, Last Updated

## License

MIT
