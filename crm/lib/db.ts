import { sql } from '@vercel/postgres';

export async function createLead(leadData: any) {
    const {
        name, email, phone, address, source,
        client_type, status,
        estimated_labor_hours, material_costs,
        gate_codes, pet_warnings, commercial_instructions
    } = leadData;

    const result = await sql`
    INSERT INTO leads (
      name, email, phone, address, source,
      client_type, status,
      estimated_labor_hours, material_costs,
      gate_codes, pet_warnings, commercial_instructions
    ) VALUES (
      ${name}, ${email}, ${phone}, ${address}, ${source},
      ${client_type || 'Residential'}, ${status || 'New'},
      ${estimated_labor_hours || 0}, ${material_costs || 0},
      ${gate_codes || ''}, ${pet_warnings || ''}, ${commercial_instructions || ''}
    )
    RETURNING *;
  `;
    return result.rows[0];
}

export async function getLeads() {
    const { rows } = await sql`SELECT * FROM leads ORDER BY created_at DESC`;
    return rows;
}

export async function updateLeadStatus(id: number, status: string) {
    const { rows } = await sql`
    UPDATE leads 
    SET status = ${status} 
    WHERE id = ${id} 
    RETURNING *;
  `;
    return rows[0];
}
