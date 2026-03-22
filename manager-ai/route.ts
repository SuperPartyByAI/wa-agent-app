import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { securityCheck } from '@/lib/security-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversation_id = searchParams.get('conversation_id');
  const client_id = searchParams.get('client_id');
  
  if (!conversation_id && !client_id) {
    return NextResponse.json({ error: "conversation_id sau client_id sunt obligatorii" }, { status: 400 });
  }
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  // ── Extract auth token and validate user ──
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (token) {
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        // Run security checks
        const check = await securityCheck({
          userId: user.id,
          email: user.email || '',
          action: 'view_live_agent',
          permission: 'view_live_agent',
          resourceType: 'system',
          ipAddress: request.headers.get('x-forwarded-for') || undefined,
        });

        if (!check.allowed) {
          return NextResponse.json({ error: check.reason || 'Access denied' }, { status: 403 });
        }
      }
    } catch (e) {
      console.warn('[SECURITY] Auth validation error in live-agent:', e);
    }
  }
  
  try {
    let actualConvId = conversation_id;
    
    // Daca aveam doar client_id, cautam conversatia activa
    if (!actualConvId && client_id) {
        const { data: convs } = await supabase.from('conversations')
            .select('id')
            .eq('client_id', client_id)
            .order('created_at', { ascending: false })
            .limit(1);
        if (convs && convs.length > 0) {
            actualConvId = convs[0].id;
        }
    }

    if (!actualConvId) {
        return NextResponse.json({ decisions: [], drafts: [] });
    }

    // 1. Fetch AI Reply Decisions
    const { data: decisions, error: err1 } = await supabase
        .from('ai_reply_decisions')
        .select('*')
        .eq('conversation_id', actualConvId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (err1) throw err1;

    // 2. Fetch AI Event Drafts
    const { data: drafts, error: err2 } = await supabase
        .from('ai_event_drafts')
        .select('*')
        .eq('conversation_id', actualConvId)
        .order('updated_at', { ascending: false })
        .limit(20);

    if (err2) throw err2;

    // 3. Fetch Shadow Training Messages
    const { data: shadow, error: err3 } = await supabase
        .from('ai_training_messages')
        .select('*')
        .eq('conversation_id', actualConvId)
        .order('created_at', { ascending: true })
        .limit(1000);
        
    if (err3) throw err3;

    // ── VIRTUAL DRAFT EXPANSION FOR UI COLUMNS ──
    const expandedDrafts: any[] = [];
    for (const draft of (drafts || [])) {
        let hasMultiple = false;
        if (draft.structured_data_json) {
            // Căutăm câmpul relevant pentru personaj(e)
            const charKey = Object.keys(draft.structured_data_json).find(k => k.toLowerCase().includes('personaj'));
            if (charKey) {
                const charVal = draft.structured_data_json[charKey];
                if (typeof charVal === 'string') {
                    // Split doar după virgulă, "și", "si", "and" (pentru a lăsa "/" intact ca fiind "SAU")
                    const parts = charVal.split(/,| și | si | and /i).map(s => s.trim()).filter(s => s);
                    if (parts.length > 1) {
                        hasMultiple = true;
                        parts.forEach((p, idx) => {
                            expandedDrafts.push({
                                ...draft,
                                id: `${draft.id}-${idx}`, // ID unic virtual pt React keys
                                structured_data_json: { ...draft.structured_data_json, [charKey]: p }
                            });
                        });
                    }
                }
            }
        }
        if (!hasMultiple) {
            expandedDrafts.push(draft);
        }
    }

    return NextResponse.json({ 
        decisions: decisions || [], 
        drafts: expandedDrafts,
        shadow_chat: shadow || []
    });
    
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
