-- Database Schema for Core Exteriors CRM
-- To be run in Vercel Postgres or any PostgreSQL database

-- 1. Create Enums for standardized fields
DO $$ BEGIN
    CREATE TYPE client_type_enum AS ENUM ('Residential', 'Commercial');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE lead_status_enum AS ENUM ('New', 'Quote Sent', 'Scheduled', 'Completed', 'Invoiced');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create the 'leads' table
CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Standard Info
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    address TEXT,
    source VARCHAR(100), -- e.g., 'Homepage', 'Contact Page', 'Referral'
    
    -- Business Logic
    client_type client_type_enum DEFAULT 'Residential',
    status lead_status_enum DEFAULT 'New',
    
    -- Profit Tracking
    estimated_labor_hours DECIMAL(10, 2) DEFAULT 0,
    actual_labor_hours DECIMAL(10, 2) DEFAULT 0,
    material_costs DECIMAL(10, 2) DEFAULT 0,
    
    -- Property Details
    gate_codes TEXT,
    pet_warnings TEXT,
    commercial_instructions TEXT,
    
    -- Integration Metadata (Internal Use)
    google_calendar_event_id VARCHAR(255),
    google_sheet_row_id INT
);

-- 3. Create indexes for common searches
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_client_type ON leads(client_type);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
