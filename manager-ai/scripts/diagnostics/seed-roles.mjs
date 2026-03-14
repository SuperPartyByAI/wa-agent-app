import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const roles = [
  { key: 'animatie', name: 'Animatie', p: ['animatie', 'animatori', 'mascote'] },
  { key: 'ursitoare', name: 'Ursitoare', p: ['ursitoare', 'zane'] },
  { key: 'arcada_pe_suport', name: 'Arcada_pe_suport', p: ['arcada pe suport', 'arcada stalpi'] },
  { key: 'arcada_fara_suport', name: 'Arcada_fara_suport', p: ['arcada organica', 'arcada fara suport'] },
  { key: 'vata_de_zahar', name: 'Vata_de_zahar', p: ['vata de zahar', 'cotton candy'] },
  { key: 'popcorn', name: 'Popcorn', p: ['popcorn', 'floricele'] },
  { key: 'vata_si_popcorn', name: 'Vata_si_popcorn', p: ['vata si popcorn'] },
  { key: 'mos_craciun', name: 'Mos_Craciun', p: ['mos craciun', 'craciun'] },
  { key: 'parfumerie', name: 'Parfumerie', p: ['parfumerie', 'atelier parfum'] },
  { key: 'arcada_cu_cifre_volumetrice', name: 'Arcada_cu_cifre_volumetrice', p: ['arcada cu cifre', 'cifre volumetrice'] }
];

async function seed() {
  console.log('Seeding...');
  for (const r of roles) {
    const entry = {
      knowledge_key: 'role_' + r.key,
      category: 'services',
      question_patterns: r.p,
      answer_template: 'Aici scrii logica rolului... \n Ex: 2 ore costa 500 RON',
      approval_status: 'approved'
    };
    
    const { error } = await supabase
      .from('ai_knowledge_base')
      .upsert(entry, { onConflict: 'knowledge_key' });
      
    if (error) {
      console.error('Error:', r.key, error);
    } else {
      console.log('Added:', r.key);
    }
  }
  console.log('Done!');
}
seed();
