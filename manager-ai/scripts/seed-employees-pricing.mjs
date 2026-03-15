/**
 * Seed Script — Employees + Pricing Amounts
 *
 * Run: node --env-file=.env scripts/seed-employees-pricing.mjs
 * Ticket: stabilizare/antigravity - Seed Data
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function seedEmployees() {
    const employees = [
        { full_name: 'Admin Superparty', email: 'admin@superparty.ro', role: 'admin', status: 'active', phone: '+40700000000', notes: 'Platform administrator' },
        { full_name: 'Ops Manager', email: 'ops@superparty.ro', role: 'manager', status: 'active', notes: 'Operations manager' },
        { full_name: 'Andrei (Animator)', email: 'andrei@superparty.ro', role: 'employee', status: 'active', notes: 'Senior animator' },
        { full_name: 'Maria (Coordinator)', email: 'maria@superparty.ro', role: 'manager', status: 'active', notes: 'Event coordinator' },
        { full_name: 'Elena (Support)', email: 'elena@superparty.ro', role: 'employee', status: 'active', notes: 'Client support' }
    ];

    const { data, error } = await supabase.from('employees').upsert(employees, { onConflict: 'email' }).select();
    if (error) {
        // If upsert fails (no unique constraint on email), try insert
        const { data: d2, error: e2 } = await supabase.from('employees').insert(employees).select();
        if (e2) throw e2;
        return d2;
    }
    return data;
}

async function seedPricingAmounts() {
    const pricing = [
        { service_id: 'animator', amount: 350, currency: 'RON', duration_hours: 2, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Standard 2h rate' },
        { service_id: 'animator', amount: 450, currency: 'RON', duration_hours: 3, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Extended 3h rate' },
        { service_id: 'ursitoare', amount: 500, currency: 'RON', duration_hours: 1, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Standard baptism ceremony' },
        { service_id: 'vata_zahar', amount: 250, currency: 'RON', duration_hours: 2, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Cotton candy machine + operator' },
        { service_id: 'popcorn', amount: 200, currency: 'RON', duration_hours: 2, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Popcorn machine + operator' },
        { service_id: 'candy_bar', amount: 600, currency: 'RON', duration_hours: 3, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Full candy bar setup' },
        { service_id: 'arcada_baloane', amount: 300, currency: 'RON', duration_hours: null, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Standard balloon arch' },
        { service_id: 'cifre_volumetrice', amount: 150, currency: 'RON', duration_hours: null, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Per digit' },
        { service_id: 'transport', amount: 50, currency: 'RON', duration_hours: null, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Standard zone transport' },
        { service_id: 'personaj_mascota', amount: 400, currency: 'RON', duration_hours: 1, status: 'approved', approved_by: 'admin', approved_at: new Date().toISOString(), notes: 'Character mascot appearance' }
    ];

    const { data, error } = await supabase.from('pricing_amounts').insert(pricing).select();
    if (error) throw error;
    return data;
}

async function main() {
    console.log('=== Seeding Employees ===');
    try {
        const emp = await seedEmployees();
        console.log(`✅ Employees seeded: ${emp.length} rows`);
    } catch (e) {
        console.error('❌ Employees seed failed:', e.message);
    }

    console.log('\n=== Seeding Pricing Amounts ===');
    try {
        const prices = await seedPricingAmounts();
        console.log(`✅ Pricing seeded: ${prices.length} rows`);
    } catch (e) {
        console.error('❌ Pricing seed failed:', e.message);
    }

    // Verify counts
    const { count: empCount } = await supabase.from('employees').select('*', { count: 'exact', head: true });
    const { count: priceCount } = await supabase.from('pricing_amounts').select('*', { count: 'exact', head: true });
    console.log(`\n=== Final Counts ===`);
    console.log(`Employees: ${empCount}`);
    console.log(`Pricing: ${priceCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
