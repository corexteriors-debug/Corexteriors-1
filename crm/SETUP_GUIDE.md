# CRM Integration Setup Guide

To connect your CRM to Vercel Postgres, Google Sheets, and Google Calendar, follow these steps.

## 1. Vercel Postgres Setup
1. Go to [Vercel.com](https://vercel.com) and sign in.
2. Link your GitHub repository (the `crm` folder).
3. Go to the **Storage** tab and click **Create Database** -> **Postgres**.
4. Once created, click "Connect to Project".
5. Go to **Settings** -> **Environment Variables**. You will see variables like `POSTGRES_URL`. Vercel adds these automatically to your deployment.

## 2. Google Sheets & Calendar Setup
### Create a Service Account
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project called `CoreExteriorsCRM`.
3. Go to **APIs & Services** -> **Library**.
4. Search for and **Enable** both:
   - **Google Sheets API**
   - **Google Calendar API**
5. Go to **APIs & Services** -> **Credentials**.
6. Click **Create Credentials** -> **Service Account**.
7. Name it `crm-sync` and click **Create and Continue**.
8. (Optional) Grant it the "Editor" role. Click **Done**.

### Generate your JSON Key
1. In the Credentials list, click on the email of the Service Account you just created.
2. Go to the **Keys** tab -> **Add Key** -> **Create New Key**.
3. Choose **JSON** and click **Create**. A file will download. **(Keep this file safe!)**

### Share your Sheet and Calendar
1. **Sheets**: Open your master Google Sheet. Click **Share** and add the service account email (ends in `@gserviceaccount.com`) as an **Editor**.
2. **Calendar**: Open Google Calendar settings. Find your calendar -> **Share with specific people** -> Add the service account email as **"Make changes to events"**.

## 3. Map the IDs
- **Spreadsheet ID**: Found in the URL of your sheet: `docs.google.com/spreadsheets/d/[THIS_PART]/edit`
- **Calendar ID**: Found in Calendar Settings -> Integration section (usually your email or a long string).

---

### What to give me:
1. Copy the **content of the JSON file** you downloaded.
2. The **Spreadsheet ID**.
3. The **Calendar ID**.

Once I have these, I can finalize the connection!
