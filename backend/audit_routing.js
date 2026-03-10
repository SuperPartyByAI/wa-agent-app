const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://jrfhprnuxxfwkwjwdsez.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZmhwcm51eHhmd2t3andkc2V6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzAwMjIzMiwiZXhwIjoyMDg4NTc4MjMyfQ.0SoUFRVD3PyQg45QKvBM0yDoGJMNrsV-1KyGX0TA4yI'
);

async function runAudit() {
  console.log("==========================================");
  console.log("=== WHATSAPP END-TO-END ROUTING AUDIT ====");
  console.log("==========================================\n");

  let issuesFound = 0;
  const duplicateConversations = [];
  const fragmentedClients = [];
  const leakedMessages = [];

  try {
    // 1. Fetch all open conversations with their clients
    console.log("[1] Fetching all open conversations...");
    const { data: convs, error: convErr } = await supabase
      .from('conversations')
      .select('id, client_id, session_id, status')
      .eq('channel', 'whatsapp')
      .eq('status', 'open');
      
    if (convErr) throw convErr;
    console.log(`    Found ${convs.length} total open WhatsApp conversations.`);

    // 2. Map all client identities to find the physical "graphs"
    console.log("[2] Fetching client identity links to map physical persons...");
    const { data: links, error: linkErr } = await supabase
      .from('client_identity_links')
      .select('client_id, identifier_value');
      
    if (linkErr) throw linkErr;

    // Group client_ids by physics identity (sharing any identifier)
    // To simplify: we map identifier_value -> array of client_ids
    const identifierToClients = {};
    links.forEach(l => {
        if (!identifierToClients[l.identifier_value]) identifierToClients[l.identifier_value] = new Set();
        identifierToClients[l.identifier_value].add(l.client_id);
    });

    // Merge intersecting sets to find true physical unique persons
    const physicalGraphs = [];
    for (const ident of Object.keys(identifierToClients)) {
        const cIds = Array.from(identifierToClients[ident]);
        
        let foundGraph = null;
        for (const graph of physicalGraphs) {
            if (cIds.some(cid => graph.has(cid))) {
                foundGraph = graph;
                break;
            }
        }
        
        if (foundGraph) {
            cIds.forEach(cid => foundGraph.add(cid));
        } else {
            physicalGraphs.push(new Set(cIds));
        }
    }

    console.log(`    Found ${physicalGraphs.length} discrete physical persons (client graphs).`);

    // Detect fragmented clients (physical persons with multiple client_ids)
    physicalGraphs.forEach((graph, index) => {
        if (graph.size > 1) {
            fragmentedClients.push({
                graphId: index,
                clientIds: Array.from(graph)
            });
        }
    });

    console.log(`    Detected ${fragmentedClients.length} fragmented client identities.`);

    // 3. Check for Intra-Route Duplicates
    console.log("[3] Auditing Intra-Route Deduplication...");
    physicalGraphs.forEach(graph => {
        const clientIds = Array.from(graph);
        // Find all open convs for this entire physical person graph
        const personConvs = convs.filter(c => clientIds.includes(c.client_id));
        
        // Group by routing session
        const sessionMap = {};
        personConvs.forEach(c => {
            if (!sessionMap[c.session_id]) sessionMap[c.session_id] = [];
            sessionMap[c.session_id].push(c);
        });

        // If any session has > 1 conv, we have a routing violation
        for (const [sessionId, cvList] of Object.entries(sessionMap)) {
            if (cvList.length > 1) {
                duplicateConversations.push({
                    physicalClientIds: clientIds,
                    route: sessionId,
                    conversations: cvList.map(c => c.id)
                });
            }
        }
    });

    if (duplicateConversations.length > 0) {
        console.log(`    [WARNING] Found ${duplicateConversations.length} INTRA-ROUTE DUPLICATE cases!`);
        issuesFound += duplicateConversations.length;
    } else {
        console.log("    [SUCCESS] No intra-route duplicates found. Strict 1 Person + 1 Route = 1 Thread rule is intact.");
    }

    // 4. Audit Cross-Route Leakage in Messages
    console.log("[4] Auditing Cross-Route Message Integrity...");
    // Only check the last 5000 messages for speed, or we can check all recent outbound
    const { data: msgs, error: msgErr } = await supabase
      .from('messages')
      .select('id, conversation_id, session_id, direction, content')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (msgErr) throw msgErr;

    // Map conversation IDs to their native session_id
    const allConvsMap = {};
    const { data: allConvs } = await supabase.from('conversations').select('id, session_id');
    allConvs.forEach(c => allConvsMap[c.id] = c.session_id);

    msgs.forEach(m => {
        const parentRoute = allConvsMap[m.conversation_id];
        if (parentRoute && m.session_id !== parentRoute) {
            leakedMessages.push({
                messageId: m.id,
                conversationId: m.conversation_id,
                expectedRoute: parentRoute,
                actualMessageRoute: m.session_id,
                direction: m.direction,
                snippet: m.content ? m.content.substring(0, 30) : ''
            });
        }
    });

    if (leakedMessages.length > 0) {
        console.log(`    [WARNING] Found ${leakedMessages.length} leaked messages bypassing strict routing constraints!`);
        issuesFound += leakedMessages.length;
    } else {
        console.log("    [SUCCESS] No cross-route leakage detected. Outbound and Inbound replies strictly obey conversation session boundaries.");
    }

    // 5. Final Report
    console.log("\n==========================================");
    console.log("=== AUDIT VERDICT");
    if (issuesFound === 0) {
        console.log("=== STATUS: PASS. The Database Routing graph is fully sanitized and stable.");
    } else {
        console.log(`=== STATUS: FAIL. Found ${issuesFound} architectural anomalies requiring cleanup.`);
    }
    console.log("==========================================\n");

    if (duplicateConversations.length > 0) {
        console.log("🚨 INTRA-ROUTE DUPLICATES (Must be consolidated):");
        console.log(JSON.stringify(duplicateConversations, null, 2));
    }

    if (leakedMessages.length > 0) {
        console.log("🚨 CROSS-ROUTE LEAKAGES (Messages attached to wrong route):");
        console.log(JSON.stringify(leakedMessages.slice(0, 5), null, 2)); // Show up to 5
    }

    if (fragmentedClients.length > 0) {
        console.log("⚠️ FRAGMENTED CLIENT IDENTITIES (Will be automatically unified by sticky guard going forward, but exist historically):");
        const showcase = fragmentedClients.length > 3 ? 3 : fragmentedClients.length;
        console.log(`(Showing ${showcase} of ${fragmentedClients.length} cases)`);
        console.log(JSON.stringify(fragmentedClients.slice(0, showcase), null, 2));
    }

  } catch (err) {
    console.error("Audit failed fatally:", err);
  }
}

runAudit();
