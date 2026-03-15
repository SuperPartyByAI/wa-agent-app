/**
 * Party Field Registry
 * 
 * Defines the definitive business vocabulary and requirement constraints for Event Dossiers.
 * This mapping is used by the Party Missing Fields Engine to compute what information the AI 
 * needs to fetch from the user before generating a quote or finalizing a booking.
 */

export const GeneralPartyFields = [
    { key: "tip_eveniment", label: "Tip eveniment", type: "string" },
    { key: "data_evenimentului", label: "Data evenimentului", type: "string" },
    { key: "ora_evenimentului", label: "Ora evenimentului", type: "string" },
    { key: "locatie_eveniment", label: "Locația evenimentului", type: "string" },
    { key: "localitate", label: "Localitate", type: "string" },
    { key: "judet", label: "Județ", type: "string" },
    { key: "adresa_completa", label: "Adresă completă", type: "string" },
    { key: "interior_sau_exterior", label: "Interior sau exterior", type: "string" },
    { key: "numar_estimativ_invitati", label: "Număr estimativ invitați", type: "number" },
    { key: "numar_copii", label: "Număr copii", type: "number" },
    { key: "nume_sarbatorit", label: "Nume sărbătorit", type: "string" },
    { key: "data_nasterii_sarbatoritului", label: "Data nașterii sărbătoritului", type: "string" },
    { key: "varsta_sarbatoritului", label: "Vârsta sărbătoritului", type: "string" },
    { key: "tematica_eveniment", label: "Tematica evenimentului", type: "string" },
    { key: "observatii_generale", label: "Observații generale", type: "string" }
];

export const BillingFields = [
    { key: "metoda_de_plata", label: "Metoda de plată", type: "string" },
    { key: "doreste_factura", label: "Dorește factură", type: "boolean" },
    { key: "nume_facturare", label: "Nume de facturare", type: "string" },
    { key: "firma", label: "Firmă", type: "string" },
    { key: "cui", label: "CUI", type: "string" },
    { key: "reg_com", label: "Registrul Comerțului", type: "string" },
    { key: "adresa_facturare", label: "Adresă de facturare", type: "string" },
    { key: "email_facturare", label: "Email facturare", type: "string" },
    { key: "persoana_contact_facturare", label: "Persoană de contact", type: "string" },
    { key: "telefon_facturare", label: "Telefon facturare", type: "string" }
];

export const CommercialFields = [
    { key: "serviciu_principal", label: "Serviciu principal" },
    { key: "servicii_solicitate", label: "Servicii solicitate" },
    { key: "pachet_selectat", label: "Pachet selectat" },
    { key: "stare_lead", label: "Stare lead" },
    { key: "obiectiv_curent", label: "Obiectiv curent" },
    { key: "urmatoarea_actiune", label: "Următoarea acțiune" },
    { key: "campuri_lipsa", label: "Câmpuri lipsă" },
    { key: "scor_lead", label: "Scor lead" },
    { key: "temperatura_lead", label: "Temperatură lead" }
];

// Mapping of specific requirements per service role
// `requiredForQuote` ensures the AI gets enough to calculate a price.
// `requiredForBooking` ensures the dossier represents a complete, lockable reservation.
export const ServiceFieldRequirements = {
    role_animatie: {
        serviceKey: "animatie",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "localitate", "numar_copii", "personaj_dorit", "durata_ore"],
        requiredForBooking: ["adresa_completa", "metoda_de_plata", "doreste_factura", "nume_sarbatorit", "varsta_sarbatoritului"],
        optional: ["interior_sau_exterior", "spatiu_disponibil", "exista_sonorizare", "alte_servicii_dorite", "observatii_logistice"],
        recommendedOrder: ["data_evenimentului", "ora_evenimentului", "localitate", "numar_copii", "personaj_dorit", "durata_ore", "nume_sarbatorit", "varsta_sarbatoritului", "metoda_de_plata", "doreste_factura"]
    },
    role_vata_de_zahar: {
        serviceKey: "vata_de_zahar",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "localitate", "durata_ore", "interior_sau_exterior"],
        requiredForBooking: ["adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"],
        optional: ["numar_estimat_copii", "numar_estimat_portii", "acces_curent_electric", "loc_amplasare_masina", "alte_servicii_dorite", "observatii_logistice", "acces_facil_locatie", "exista_masa_echipament", "interval_montaj"],
        recommendedOrder: ["data_evenimentului", "ora_evenimentului", "localitate", "durata_ore", "interior_sau_exterior", "adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"]
    },
    role_popcorn: {
        serviceKey: "popcorn",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "localitate", "durata_ore", "interior_sau_exterior"],
        requiredForBooking: ["adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"],
        optional: ["numar_estimat_invitati", "numar_estimat_portii", "acces_curent_electric", "spatiu_amplasare", "alte_servicii_dorite", "observatii_logistice", "tip_public", "mod_servire"],
        recommendedOrder: ["data_evenimentului", "ora_evenimentului", "localitate", "durata_ore", "interior_sau_exterior", "adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"]
    },
    role_vata_si_popcorn: {
        serviceKey: "vata_si_popcorn",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "localitate", "durata_ore", "interior_sau_exterior"],
        requiredForBooking: ["adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"],
        optional: ["numar_estimat_invitati", "numar_estimat_copii", "acces_curent_electric", "spatiu_amplasare", "alte_servicii_dorite", "observatii_logistice", "amplasare_aceeasi_zona", "alimentare_simultana"],
        recommendedOrder: ["data_evenimentului", "ora_evenimentului", "localitate", "durata_ore", "interior_sau_exterior", "adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"]
    },
    role_arcada_fara_suport: {
        serviceKey: "arcada_fara_suport",
        requiredForQuote: ["data_evenimentului", "localitate", "metri_liniari", "model_arcada", "culori_dorite"],
        requiredForBooking: ["adresa_completa", "zona_amplasare", "interior_sau_exterior", "metoda_de_plata", "doreste_factura"],
        optional: ["tematica_eveniment", "dimensiune_spatiu", "fotografie_referinta", "ora_montaj", "ora_evenimentului", "observatii_logistice", "cine_asigura_demontarea", "exista_punct_sprijin", "acces_locatie_montaj"],
        recommendedOrder: ["data_evenimentului", "localitate", "metri_liniari", "model_arcada", "culori_dorite", "interior_sau_exterior", "zona_amplasare", "adresa_completa", "metoda_de_plata", "doreste_factura"]
    },
    role_arcada_cu_cifre_volumetrice: {
        serviceKey: "arcada_cu_cifre_volumetrice",
        requiredForQuote: ["data_evenimentului", "localitate", "metri_liniari", "model_arcada", "cifre_dorite", "culori_dorite"],
        requiredForBooking: ["adresa_completa", "zona_amplasare", "interior_sau_exterior", "ora_montaj", "metoda_de_plata", "doreste_factura"],
        optional: ["culoare_cifre", "tematica_eveniment", "fotografie_referinta", "observatii_logistice", "dimensiune_cifre", "cifre_simple_sau_decorate"],
        recommendedOrder: ["data_evenimentului", "localitate", "metri_liniari", "model_arcada", "cifre_dorite", "culori_dorite", "interior_sau_exterior", "zona_amplasare", "ora_montaj", "adresa_completa", "metoda_de_plata", "doreste_factura"]
    },
    role_arcada_pe_suport: {
        serviceKey: "arcada_pe_suport",
        requiredForQuote: ["data_evenimentului", "localitate", "tip_suport", "culori_dorite"],
        requiredForBooking: ["adresa_completa", "zona_amplasare", "interior_sau_exterior", "ora_montaj", "metoda_de_plata", "doreste_factura"],
        optional: ["tematica_eveniment", "fotografie_referinta", "observatii_logistice", "dimensiune_suport", "model_standard_sau_personalizat", "elemente_extra_suport"],
        recommendedOrder: ["data_evenimentului", "localitate", "tip_suport", "culori_dorite", "interior_sau_exterior", "zona_amplasare", "ora_montaj", "adresa_completa", "metoda_de_plata", "doreste_factura"]
    },
    role_ursitoare: {
        serviceKey: "ursitoare",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "localitate", "nume_sarbatorit", "tip_locatie"],
        requiredForBooking: ["adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"],
        optional: ["program_ursitoare", "numar_invitati", "botez_restaurant_sau_acasa", "observatii_logistice", "tematica_dorita", "sex_copil", "varsta_sarbatoritului", "stil_moment", "program_exact_intrare"],
        recommendedOrder: ["data_evenimentului", "ora_evenimentului", "localitate", "nume_sarbatorit", "tip_locatie", "adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"]
    },
    role_mos_craciun: {
        serviceKey: "mos_craciun",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "localitate", "tip_eveniment", "durata_vizita"],
        requiredForBooking: ["adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"],
        optional: ["numar_copii", "numele_copiilor", "varstele_copiilor", "se_ofera_cadouri", "cine_da_cadourile", "observatii_logistice", "tip_locatie", "mosul_stie_numele", "mesaj_personalizat", "intra_singur_sau_cu_ajutor"],
        recommendedOrder: ["data_evenimentului", "ora_evenimentului", "localitate", "tip_eveniment", "durata_vizita", "adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"]
    },
    role_parfumerie: {
        serviceKey: "parfumerie",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "localitate", "tip_eveniment", "numar_participanti"],
        requiredForBooking: ["adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"],
        optional: ["interval_dorit", "varsta_participantilor", "interior_sau_exterior", "spatiu_disponibil", "observatii_logistice", "copii_sau_adulti", "atelier_sau_stand", "branding_personalizare"],
        recommendedOrder: ["data_evenimentului", "ora_evenimentului", "localitate", "tip_eveniment", "numar_participanti", "adresa_completa", "persoana_contact", "telefon_contact", "metoda_de_plata", "doreste_factura"]
    }
};

/**
 * Returns merged constraints for a specific active role set.
 * Ensures the Missing Fields Engine knows exactly what to hunt for.
 */
export function getRequirementsForRoles(activeRoleKeys) {
    const requiredLevel1 = new Set();
    const requiredLevel2 = new Set();
    const allowedOptionals = new Set();
    const combinedOrder = new Set();

    activeRoleKeys.forEach(role => {
        const specs = ServiceFieldRequirements[role];
        if (specs) {
            specs.requiredForQuote.forEach(f => requiredLevel1.add(f));
            specs.requiredForBooking.forEach(f => requiredLevel2.add(f));
            if (specs.optional) specs.optional.forEach(f => allowedOptionals.add(f));
            if (specs.recommendedOrder) {
                specs.recommendedOrder.forEach(f => combinedOrder.add(f));
            }
        }
    });

    // If a field is required but missing from recommendedOrder, push it to the end
    Array.from(requiredLevel1).forEach(f => {
        if (!combinedOrder.has(f)) combinedOrder.add(f);
    });

    Array.from(requiredLevel2).forEach(f => {
        if (!combinedOrder.has(f)) combinedOrder.add(f);
    });

    return {
        level1_quote: Array.from(requiredLevel1),
        level2_booking: Array.from(requiredLevel2),
        optionals: Array.from(allowedOptionals),
        recommendedOrder: Array.from(combinedOrder)
    };
}
