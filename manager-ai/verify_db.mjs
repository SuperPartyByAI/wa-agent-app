import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const vertexDb = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    try {
        const { data, error } = await vertexDb.from('vertex_config').select('config_value').eq('config_key', 'system_prompt').single();
        if (error) throw error;
        
        if (data) {
            const prompt = data.config_value;
            const styleSection = prompt.substring(prompt.indexOf('STIL DE COMUNICARE:'));
            console.log("=== SECTIUNEA STIL DE COMUNICARE DIN BAZA DE DATE ===");
            console.log(styleSection.substring(0, 1000));
        } else {
            console.log("Nu s-a gasit system_prompt.");
        }
    } catch (err) {
        console.error("Eroare la citire:", err.message);
    } finally {
        process.exit(0);
    }
})();
