import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './src/config/env.mjs';
import { createClient } from '@supabase/supabase-js';

const vtxSupa = createClient(process.env.VERTEX_SUPABASE_URL || SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY);

const TITLES_TO_DELETE = [
    "Prețuri Animatori", 
    "Prețuri Ursitoare", 
    "Prețuri Mascote", 
    "Prețuri Baloane / Decoratiuni", 
    "Prețuri Popcorn", 
    "Prețuri Vată de Zahăr", 
    "Prețuri Cabina Foto / Oglinda"
];

async function run() {
    console.log("=> Incepem stergerea prostiilor inserate...");
    const { error } = await vtxSupa.from('vertex_sources').delete().in('title', TITLES_TO_DELETE);
    if (error) {
        console.error("Eroare la rollback:", error);
    } else {
        console.log("=> ROLLBACK COMPLET. Am sters toate textele demonstrate adaugate de mine la QR-uri.");
    }
}
run();
