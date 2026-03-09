require("dotenv").config();
const { createClient } = require('@supabase/supabase-js');

// Init Supabase CRM Engine
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jrfhprnuxxfwkwjwdsez.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "INSERT_YOUR_SECRET_ROLE_KEY_HERE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = supabase;
