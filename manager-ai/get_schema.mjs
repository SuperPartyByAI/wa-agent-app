import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Since we cannot run raw queries easily with supabase-js v2 without RPC, 
// let's just use pg directly since it's likely installed or we can just fetch via RPC.
// Wait, a better way is to do a raw fetch to the REST API /rpc or just use REST
