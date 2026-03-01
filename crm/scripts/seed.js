const { sql } = require('@vercel/postgres');
require('dotenv').config({ path: '.env.development.local' });

async function seed() {
  try {
    console.log('Dropping existing table if exists...');
    await sql`DROP TABLE IF EXISTS leads`;

    console.log('Creating Leads Table (no ENUMs for simplicity)...');
    await sql`
      CREATE TABLE leads (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        source VARCHAR(100),
        client_type VARCHAR(50) DEFAULT 'Residential',
        status VARCHAR(50) DEFAULT 'New',
        estimated_labor_hours DECIMAL(10, 2) DEFAULT 0,
        actual_labor_hours DECIMAL(10, 2) DEFAULT 0,
        material_costs DECIMAL(10, 2) DEFAULT 0,
        gate_codes TEXT,
        pet_warnings TEXT,
        commercial_instructions TEXT,
        google_calendar_event_id VARCHAR(255),
        google_sheet_row_id INT
      );
    `;

    console.log('✅ Table created successfully!');

    console.log('Inserting test lead...');
    await sql`
      INSERT INTO leads (name, email, phone, address, source, client_type, status)
      VALUES ('Test User', 'test@example.com', '555-0123', '123 Main St', 'Manual', 'Residential', 'New');
    `;

    console.log('✅ Test lead inserted!');
    console.log('Database seeded successfully!');
  } catch (error) {
    console.error('❌ Seed Error:', error);
    process.exit(1);
  }
}

seed();
