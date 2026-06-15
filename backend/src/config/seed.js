/**
 * HandyTrust — Database Seeder
 * Seeds: service_configs, default admin user
 * Run: node src/config/seed.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');
const logger = require('../utils/logger');

const SERVICE_CONFIGS = [
    {
        category: 'plumbing',
        display_name: 'Plumbing',
        icon: 'wrench',
        base_price_ngn: 8000,
        checklist_template: [
            { id: 1, label: 'Identify leak source / fault', checked: false },
            { id: 2, label: 'Obtain customer approval on scope', checked: false },
            { id: 3, label: 'Complete repair', checked: false },
            { id: 4, label: 'Test water flow / pressure', checked: false },
            { id: 5, label: 'Clean work area', checked: false },
        ],
        matching_weights: { proximity: 0.30, rating: 0.25, completion: 0.20, response: 0.15, verification: 0.10 },
    },
    {
        category: 'electrical',
        display_name: 'Electrical',
        icon: 'bolt',
        base_price_ngn: 10000,
        checklist_template: [
            { id: 1, label: 'Inspect fault / circuit', checked: false },
            { id: 2, label: 'Isolate power supply', checked: false },
            { id: 3, label: 'Complete electrical work', checked: false },
            { id: 4, label: 'Test all outlets / switches', checked: false },
            { id: 5, label: 'Safety sign-off', checked: false },
        ],
        matching_weights: { proximity: 0.25, rating: 0.30, completion: 0.20, response: 0.15, verification: 0.10 },
    },
    {
        category: 'ac_hvac',
        display_name: 'AC / HVAC',
        icon: 'snowflake',
        base_price_ngn: 15000,
        checklist_template: [
            { id: 1, label: 'Diagnose AC unit', checked: false },
            { id: 2, label: 'Clean filters / coils', checked: false },
            { id: 3, label: 'Recharge refrigerant if needed', checked: false },
            { id: 4, label: 'Test cooling performance', checked: false },
        ],
        matching_weights: { proximity: 0.25, rating: 0.25, completion: 0.25, response: 0.15, verification: 0.10 },
    },
    {
        category: 'carpentry',
        display_name: 'Carpentry',
        icon: 'hammer',
        base_price_ngn: 12000,
        checklist_template: [
            { id: 1, label: 'Assess wood / fitting requirements', checked: false },
            { id: 2, label: 'Source materials (if needed)', checked: false },
            { id: 3, label: 'Complete woodwork', checked: false },
            { id: 4, label: 'Sand and finish', checked: false },
            { id: 5, label: 'Customer inspection', checked: false },
        ],
        matching_weights: { proximity: 0.20, rating: 0.30, completion: 0.25, response: 0.15, verification: 0.10 },
    },
    {
        category: 'painting',
        display_name: 'Painting',
        icon: 'paint-roller',
        base_price_ngn: 20000,
        checklist_template: [
            { id: 1, label: 'Surface preparation', checked: false },
            { id: 2, label: 'Primer coat', checked: false },
            { id: 3, label: 'First paint coat', checked: false },
            { id: 4, label: 'Second coat / finishing', checked: false },
            { id: 5, label: 'Clean drips and edges', checked: false },
        ],
        matching_weights: { proximity: 0.20, rating: 0.30, completion: 0.25, response: 0.15, verification: 0.10 },
    },
    {
        category: 'cleaning',
        display_name: 'Cleaning',
        icon: 'sparkles',
        base_price_ngn: 6000,
        checklist_template: [
            { id: 1, label: 'Dust and sweep', checked: false },
            { id: 2, label: 'Mop floors', checked: false },
            { id: 3, label: 'Clean bathrooms', checked: false },
            { id: 4, label: 'Kitchen surfaces', checked: false },
            { id: 5, label: 'Waste disposal', checked: false },
        ],
        matching_weights: { proximity: 0.30, rating: 0.25, completion: 0.20, response: 0.15, verification: 0.10 },
    },
    {
        category: 'solar',
        display_name: 'Solar Installation',
        icon: 'sun',
        base_price_ngn: 50000,
        checklist_template: [
            { id: 1, label: 'Site assessment', checked: false },
            { id: 2, label: 'Mount solar panels', checked: false },
            { id: 3, label: 'Wiring and inverter setup', checked: false },
            { id: 4, label: 'Battery connection', checked: false },
            { id: 5, label: 'System test and handover', checked: false },
        ],
        matching_weights: { proximity: 0.15, rating: 0.35, completion: 0.25, response: 0.15, verification: 0.10 },
    },
    {
        category: 'appliance_repair',
        display_name: 'Appliance Repair',
        icon: 'microchip',
        base_price_ngn: 7000,
        checklist_template: [
            { id: 1, label: 'Diagnose fault', checked: false },
            { id: 2, label: 'Source replacement part if needed', checked: false },
            { id: 3, label: 'Repair / replace', checked: false },
            { id: 4, label: 'Test appliance function', checked: false },
        ],
        matching_weights: { proximity: 0.25, rating: 0.30, completion: 0.20, response: 0.15, verification: 0.10 },
    },
];

async function seed() {
    const client = await pool.connect();
    try {
        logger.info('Seeding database…');

        // Service configs
        for (const cfg of SERVICE_CONFIGS) {
            await client.query(
                `INSERT INTO service_configs
           (category, display_name, icon, base_price_ngn, checklist_template, matching_weights)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (category) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           base_price_ngn = EXCLUDED.base_price_ngn,
           checklist_template = EXCLUDED.checklist_template,
           matching_weights = EXCLUDED.matching_weights`,
                [
                    cfg.category,
                    cfg.display_name,
                    cfg.icon,
                    cfg.base_price_ngn,
                    JSON.stringify(cfg.checklist_template),
                    JSON.stringify(cfg.matching_weights),
                ]
            );
        }
        logger.info(`✅ Seeded ${SERVICE_CONFIGS.length} service configs`);

        // Default admin user
        const adminPhone = process.env.ADMIN_PHONE || '+2348000000001';
        const adminPass = process.env.ADMIN_PASSWORD || 'HandyTrust@Admin2024!';
        const hash = await bcrypt.hash(adminPass, 12);

        await client.query(
            `INSERT INTO users (phone, full_name, role, status, password_hash, phone_verified, referral_code)
       VALUES ($1, 'HandyTrust Admin', 'admin', 'active', $2, TRUE, 'HTADMIN')
       ON CONFLICT (phone) DO NOTHING`,
            [adminPhone, hash]
        );
        logger.info('✅ Admin user seeded');

        logger.info('🎉 Seed complete');
    } catch (err) {
        logger.error('Seed failed', { error: err.message });
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();