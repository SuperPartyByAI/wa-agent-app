/**
 * Smoke Test — Vertex AI Integration
 * Testează: conectivitate API, Function Calling, și persistență Supabase.
 */
import dotenv from 'dotenv';
dotenv.config();

import { processWithVertexAI, loadSystemPrompt, vertexDb } from './src/vertex/vertexClient.mjs';

const TEST_PHONE = '+40700000001';

async function runTests() {
    console.log('=== Vertex AI Smoke Test ===\n');

    // Test 1: Supabase connectivity
    console.log('1. Testing Vertex Supabase connectivity...');
    if (vertexDb) {
        const { data, error } = await vertexDb.from('vertex_config').select('config_key, config_value');
        if (error) {
            console.error('   ❌ Supabase error:', error.message);
        } else {
            console.log(`   ✅ Connected! ${data.length} config rows found.`);
            data.forEach(r => console.log(`      ${r.config_key} = ${r.config_value.substring(0, 60)}...`));
        }
    } else {
        console.log('   ⚠️  No Vertex Supabase configured');
    }

    // Test 2: Load system prompt
    console.log('\n2. Loading system prompt from config...');
    const prompt = await loadSystemPrompt();
    console.log(`   ✅ Prompt loaded (${prompt.length} chars): "${prompt.substring(0, 80)}..."`);

    // Test 3: Simple conversation
    console.log('\n3. Testing simple conversation...');
    try {
        const result = await processWithVertexAI(TEST_PHONE, 'Bună ziua! Vreau să organizez o petrecere pentru copilul meu.');
        console.log(`   ✅ Reply (${result.latencyMs}ms): "${result.reply?.substring(0, 120)}..."`);
        if (result.functionCall) {
            console.log(`   🔧 Function called: ${result.functionCall.name}`);
            console.log(`   📦 Result:`, result.functionResult);
        }
    } catch (err) {
        console.error(`   ❌ Error:`, err.message);
    }

    // Test 4: Function Calling (book event)
    console.log('\n4. Testing Function Calling (noteaza_petrecere)...');
    try {
        const result = await processWithVertexAI(TEST_PHONE, 'Vreau o petrecere pe 15 iulie, 30 de copii, cu animator și candy bar, la București.');
        console.log(`   ✅ Reply (${result.latencyMs}ms): "${result.reply?.substring(0, 120)}..."`);
        if (result.functionCall) {
            console.log(`   🔧 Function: ${result.functionCall.name}`);
            console.log(`   📋 Args:`, JSON.stringify(result.functionCall.args, null, 2));
            console.log(`   📦 Result:`, JSON.stringify(result.functionResult, null, 2));
        } else {
            console.log('   ⚠️  No function call triggered (AI may have asked for more details)');
        }
    } catch (err) {
        console.error(`   ❌ Error:`, err.message);
    }

    // Test 5: Check stored data
    if (vertexDb) {
        console.log('\n5. Checking stored data...');
        const { data: sessions } = await vertexDb.from('vertex_sessions').select('*').eq('phone_e164', TEST_PHONE);
        console.log(`   📱 Sessions: ${sessions?.length || 0}`);
        
        const { data: messages } = await vertexDb.from('vertex_messages').select('role, content').order('created_at', { ascending: false }).limit(5);
        console.log(`   💬 Recent messages: ${messages?.length || 0}`);
        messages?.forEach(m => console.log(`      [${m.role}] ${(m.content || '').substring(0, 60)}`));
        
        const { data: events } = await vertexDb.from('vertex_events').select('*').eq('phone_e164', TEST_PHONE);
        console.log(`   🎉 Events: ${events?.length || 0}`);
        events?.forEach(e => console.log(`      ${e.event_type} | ${e.event_date} | ${e.guest_count} invitați | ${JSON.stringify(e.services)}`));
        
        const { data: actions } = await vertexDb.from('vertex_action_logs').select('action_name, success').order('executed_at', { ascending: false }).limit(5);
        console.log(`   🔧 Actions: ${actions?.length || 0}`);
        actions?.forEach(a => console.log(`      ${a.action_name}: ${a.success ? '✅' : '❌'}`));
    }

    console.log('\n=== Smoke Test Complete ===');
}

runTests().catch(console.error);
