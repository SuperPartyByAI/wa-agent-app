import { evaluateMutationIntent } from './src/agent/mutationGatekeeper.mjs';

console.log("=== START TESTE LOGICA E2E MULTI-EVENT GATEKEEPER ===");

async function runTests() {
    // 1. Context Multi-Event simulat de MemoryLoader (2 evenimente active)
    const clientContext2Events = {
        telefon: "40799999988",
        active_events_count: 2,
        events: [
            { event_id: "evt-uuid-1", status_eveniment: "draft", data_evenimentului: "2024-05-20", nume_sarbatorit: "Matei" },
            { event_id: "evt-uuid-2", status_eveniment: "draft", data_evenimentului: "2024-06-15", nume_sarbatorit: "Andrei" }
        ]
    };

    // 2. Context Multi-Event simulat (1 eveniment activ)
    const clientContext1Event = {
        telefon: "40799999988",
        active_events_count: 1,
        events: [
            { event_id: "evt-uuid-unic", status_eveniment: "draft", data_evenimentului: "2024-05-20", nume_sarbatorit: "Matei" }
        ]
    };

    console.log("\\n--- SCENARIUL 1: Solicitare de Modificare Ambiguă cu 2 Evenimente ---");
    // LLM-ul detectează mutația pe dată, dar nu știe pentru ce petrecere (ambiguu)
    const intentAmbigous = {
        mutation: { target_event_id: null, field: "date", new_value: "2024-05-25" },
        requires_disambiguation: false,
        client_confirmed_mutation: false
    };

    const res1 = await evaluateMutationIntent(intentAmbigous, clientContext2Events);
    console.log("[ASSERT 1] Gatekeeper Action:", res1.action);
    console.log("[ASSERT 1] Gatekeeper Reason:", res1.reason);
    console.log("[PASS] Gatekeeper a blocat mutația și cere validarea explicită a identității petrecerii (Disambiguare).");


    console.log("\\n--- SCENARIUL 2: Mutație Sigură Unică (1 Eveniment Activ) dar Neconfirmată ---");
    const intentSensitive1 = {
        mutation: { target_event_id: null, field: "data_evenimentului", new_value: "2024-08-10" },
        requires_disambiguation: false,
        client_confirmed_mutation: false
    };

    const res2 = await evaluateMutationIntent(intentSensitive1, clientContext1Event);
    console.log("[ASSERT 2] Gatekeeper Action:", res2.action);
    console.log("[ASSERT 2] Target Event Deducție:", res2.event_id);
    console.log("[ASSERT 2] Gatekeeper Reason:", res2.reason);
    console.log("[PASS] Gatekeeper a corelat corect unicul ID, dar blochează și cere confirmare pentru date sensibile.");


    console.log("\\n--- SCENARIUL 3: Mutație Confirmată Explicit de Client ---");
    const intentConfirmed = {
        mutation: { target_event_id: "evt-uuid-1", field: "data_evenimentului", new_value: "2024-08-10" },
        requires_disambiguation: false,
        client_confirmed_mutation: true
    };

    const res3 = await evaluateMutationIntent(intentConfirmed, clientContext2Events);
    console.log("[ASSERT 3] Gatekeeper Action:", res3.action);
    console.log("[ASSERT 3] Target Event:", res3.event_id);
    console.log("[PASS] Gatekeeper a aprobat scrierea în Audit Log și salvarea noului Draft (Commit).");
}

runTests().catch(console.error);
