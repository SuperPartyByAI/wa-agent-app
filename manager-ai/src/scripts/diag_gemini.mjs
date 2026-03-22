import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  console.log('--- DIAGNOSTIC GEMINI SERVER ---');
  const key = process.env.GEMINI_API_KEY;
  console.log('Key Sample:', key ? `${key.substring(0, 5)}...${key.substring(key.length - 4)}` : 'MISSING');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Say HELLO' }] }]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('Status:', res.status, res.statusText);
    const data = await res.json();
    console.log('Gemini Response:', JSON.stringify(data).substring(0, 100));
  } catch (e) {
    console.error('Fetch Error:', e.message);
  }
}
run();
