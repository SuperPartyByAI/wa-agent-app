import fs from 'node:fs';
const catalogPath = './service-catalog.json';
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

// Apply remaps
catalog.services.forEach(svc => {
  if (svc.service_key === 'arcada_baloane') {
    svc.service_key = 'arcada_cu_cifre_volumetrice';
    svc.display_name = 'Arcada cu Cifre Volumetrice';
    svc.required_fields = ['data_eveniment', 'locatie', 'linear_meters'];
    svc.optional_fields = ['model_choice'];
    svc.standard_questions = [
      'De cati metri sa fie arcada?',
      'Ce model si culori preferati?'
    ];
  }
  else if (svc.service_key === 'arcada_exterior') {
    svc.service_key = 'arcada_fara_suport';
    svc.display_name = 'Arcada fara Suport';
    svc.required_fields = ['data_eveniment', 'locatie', 'linear_meters'];
    svc.optional_fields = ['model_choice'];
    svc.standard_questions = [
      'De cati metri liniari sa fie arcada?',
      'Ce culori si ce forma doriti?'
    ];
  }
  else if (svc.service_key === 'arcada_suport') {
    svc.service_key = 'arcada_pe_suport';
    svc.display_name = 'Arcada pe Suport';
    svc.required_fields = ['data_eveniment', 'locatie'];
    svc.optional_fields = ['model_choice'];
    svc.standard_questions = [
      'Ce model doriti pentru arcada?',
      'Pentru ce data este evenimentul?'
    ];
  }
  else if (svc.service_key === 'vata_zahar') {
    svc.service_key = 'vata_de_zahar';
  }
  else if (svc.service_key === 'animator') {
    svc.service_key = 'animatie';
  }
});

// Add vata_si_popcorn if missing
if (!catalog.services.find(s => s.service_key === 'vata_si_popcorn')) {
  catalog.services.push({
    service_key: 'vata_si_popcorn',
    display_name: 'Vata de Zahar si Popcorn',
    description: 'Pachet vata + popcorn.',
    required_fields: ['data_eveniment', 'locatie', 'durata_ore', 'nr_estimat_portii'],
    optional_fields: [],
    standard_questions: [
      'Cate ore doriti pachetul?',
      'Pentru cate persoane aproximativ?'
    ]
  });
}

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log('Catalog patched.');
