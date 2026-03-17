import { vertexDb } from './src/vertex/vertexClient.mjs';

async function test() {
    try {
        console.log('Testing vertexDb query...');
        if (!vertexDb) {
            console.error('vertexDb is null!');
            return;
        }
        const { data, error } = await vertexDb.from('ai_notebook_templates').select('*');
        if (error) {
            console.error('Supabase Error:', error);
        } else {
            console.log('Success!', data);
        }
    } catch (e) {
        console.error('Runtime Exception:', e);
    }
}
test();
