const { sql } = require('@vercel/postgres');
require('dotenv').config({ path: '.env.development.local' });

async function check() {
    try {
        console.log('Checking database connection...');
        const result = await sql`SELECT count(*) FROM leads`;
        console.log('Connection successful!');
        console.log('Lead count:', result.rows[0].count);

        const leads = await sql`SELECT * FROM leads LIMIT 1`;
        console.log('Sample lead:', leads.rows[0]);
    } catch (error) {
        console.error('Check Error:', error);
        process.exit(1);
    }
}

check();
