# Syncing your CRM with Supabase

To see the same leads on both your PC and laptop, you can connect the CRM to a free Supabase account.

## 1. Create a Supabase Project
1. Go to [supabase.com](https://supabase.com) and sign up for a free account.
2. Create a new project named `CoreExteriorsCRM`.
3. Go to **Table Editor** -> **New Table**.
   - Name: `leads`
   - Uncheck "Enable Row Level Security (RLS)" for now (or set up a public policy).
   - Columns:
     - `id` (int8, primary key, autoincrement)
     - `created_at` (timestamptz, default: `now()`)
     - `name` (text)
     - `email` (text)
     - `phone` (text)
     - `address` (text)
     - `service` (text)
     - `message` (text)
     - `status` (text, default: `'New'`)
     - `source` (text)
     - `date` (timestamptz)

## 2. Get your API Credentials
1. Go to **Project Settings** -> **API**.
2. Copy the **Project URL**.
3. Copy the **anon public API Key**.

## 3. Update `crm-service.js`
I can help you update the code once you have these keys! We will replace the `localStorage` logic with Supabase API calls.

> [!NOTE]
> For now, the CRM works perfectly on whatever device you are using, but the data is stored locally in your browser.
