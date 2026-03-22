import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const vertexUrl = process.env.VERTEX_SUPABASE_URL || process.env.SUPABASE_URL;
const vertexKey = process.env.VERTEX_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const vertexDb = createClient(vertexUrl, vertexKey);

async function merge() {
    console.log('--- RESTAURARE MEMORIE AI VERTEX V2 ---');
    const ghostPhoneString = '7aa2bd65-89c3-4de2-8000-e3f1e3dec7aa';
    
    // Găsim ID-ul sesiunii fantomă
    const { data: ghostSess } = await vertexDb.from('vertex_sessions').select('id').eq('phone_number', ghostPhoneString).order('created_at', {ascending: false}).limit(1).maybeSingle();
    if (!ghostSess) {
        console.log('Nici o sesiune fantoma pe acest UUID.');
    } else {
        const sOld = ghostSess.id;
        const sNew = '65615ea5-c0a9-4544-9229-5cd70d8b2d6c'; // real session +40737571397
        
        const { data: ghosts } = await vertexDb.from('vertex_messages').select('*').eq('session_id', sOld);
        if(!ghosts) console.log("Eroare de extragere mesajele fantoma!");
        else {
            console.log('Am gasit ' + ghosts.length + ' mesaje in sesiunea fantoma de la id: ' + sOld);
            
            if (ghosts.length > 0) {
                const { error } = await vertexDb.from('vertex_messages')
                    .update({ session_id: sNew })
                    .eq('session_id', sOld);
                    
                if (error) console.error('Eroare la update:', error);
                else console.log('✅ Succes! Istoria veche mutata la sesiunea reala a aplicatiei!');
            }
        }
    }
}
merge();
