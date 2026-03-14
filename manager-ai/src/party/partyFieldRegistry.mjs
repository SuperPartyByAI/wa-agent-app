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
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa", "personaj_dorit", "numar_copii"],
        requiredForBooking: ["nume_sarbatorit", "data_nasterii_sarbatoritului", "varsta_sarbatoritului", "metoda_de_plata", "doreste_factura"],
        optional: ["numar_animatori", "tematica_dorita", "interior_sau_exterior", "activitati_dorite", "observatii_animatie"],
        detailsSchema: {
            personaj_dorit: "string",
            numar_animatori: "number",
            durata_ore: "number",
            tematica_dorita: "string",
            activitati_dorite: "string",
            observatii_animatie: "string"
        }
    },
    role_ursitoare: {
        serviceKey: "ursitoare",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa"],
        requiredForBooking: ["nume_copil", "sex_copil", "metoda_de_plata", "doreste_factura"],
        optional: ["numar_invitati", "tip_moment", "durata_moment", "observatii_ursitoare"],
        detailsSchema: {
            nume_copil: "string",
            sex_copil: "string",
            tip_moment: "string",
            durata_moment: "number",
            observatii_ursitoare: "string"
        }
    },
    role_vata_zahar: {
        serviceKey: "vata_de_zahar",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa", "durata_ore"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["numar_estimat_portii", "interior_sau_exterior", "acces_curent_electric", "observatii_vata_de_zahar"],
        detailsSchema: {
            durata_ore: "number",
            numar_estimat_portii: "number",
            acces_curent_electric: "boolean",
            observatii_vata_de_zahar: "string"
        }
    },
    role_popcorn: {
        serviceKey: "popcorn",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa", "durata_ore"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["numar_estimat_portii", "acces_curent_electric", "observatii_popcorn"],
        detailsSchema: {
            durata_ore: "number",
            numar_estimat_portii: "number",
            acces_curent_electric: "boolean",
            observatii_popcorn: "string"
        }
    },
    role_vata_popcorn: {
        serviceKey: "vata_si_popcorn",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa", "durata_ore"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["numar_estimat_portii", "acces_curent_electric", "observatii_pachet"],
        detailsSchema: {
            durata_ore: "number",
            numar_estimat_portii: "number",
            acces_curent_electric: "boolean",
            observatii_pachet: "string"
        }
    },
    role_arcada_fara_suport: {
        serviceKey: "arcada_fara_suport",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa", "metri_liniari", "model_arcada"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["culori_dorite", "zona_amplasare", "interior_sau_exterior", "observatii_arcada_fara_suport"],
        detailsSchema: {
            metri_liniari: "number",
            model_arcada: "string",
            culori_dorite: "string",
            zona_amplasare: "string",
            observatii_arcada_fara_suport: "string"
        }
    },
    role_arcada_cu_cifre: {
        serviceKey: "arcada_cu_cifre_volumetrice",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa", "metri_liniari", "model_arcada", "cifre_dorite"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["culoare_cifre", "culori_arcada", "zona_amplasare", "observatii_arcada_cu_cifre"],
        detailsSchema: {
            metri_liniari: "number",
            model_arcada: "string",
            cifre_dorite: "string",
            culoare_cifre: "string",
            culori_arcada: "string",
            zona_amplasare: "string",
            observatii_arcada_cu_cifre: "string"
        }
    },
    role_arcada_pe_suport: {
        serviceKey: "arcada_pe_suport",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["culori_dorite", "zona_amplasare", "interior_sau_exterior", "tip_suport", "observatii_arcada_pe_suport"],
        detailsSchema: {
            tip_suport: "string",
            culori_dorite: "string",
            zona_amplasare: "string",
            observatii_arcada_pe_suport: "string"
        }
    },
    role_mos_craciun: {
        serviceKey: "mos_craciun",
        requiredForQuote: ["data_evenimentului", "ora_vizitei", "adresa_completa", "numar_copii"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["nume_copii", "cadouri_pregatite", "tip_eveniment", "durata_vizita", "observatii_mos_craciun"],
        detailsSchema: {
            ora_vizitei: "string",
            durata_vizita: "number",
            numar_copii: "number",
            cadouri_pregatite: "boolean",
            observatii_mos_craciun: "string"
        }
    },
    role_parfumerie: {
        serviceKey: "parfumerie",
        requiredForQuote: ["data_evenimentului", "ora_evenimentului", "adresa_completa", "numar_participanti"],
        requiredForBooking: ["metoda_de_plata", "doreste_factura"],
        optional: ["varsta_participantilor", "durata_atelier", "tip_eveniment", "format_atelier", "observatii_parfumerie"],
        detailsSchema: {
            numar_participanti: "number",
            durata_atelier: "number",
            format_atelier: "string",
            observatii_parfumerie: "string"
        }
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

    activeRoleKeys.forEach(role => {
        const specs = ServiceFieldRequirements[role];
        if (specs) {
            specs.requiredForQuote.forEach(f => requiredLevel1.add(f));
            specs.requiredForBooking.forEach(f => requiredLevel2.add(f));
            if (specs.optional) specs.optional.forEach(f => allowedOptionals.add(f));
        }
    });

    return {
        level1_quote: Array.from(requiredLevel1),
        level2_booking: Array.from(requiredLevel2),
        optionals: Array.from(allowedOptionals)
    };
}
