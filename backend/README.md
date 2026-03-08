# Open-WQ - WhatsApp Multi-Session Manager

O aplicație Node.js de producție care folosește `@open-wa/wa-automate` pentru a instanția și gestiona un număr nelimitat de instanțe headless de WhatsApp simultan, oferind un nivel stabil de **API REST** pentru integrarea cu servicii externe precum 3CX.

## Caracteristici Curente (Finalizate) ✅

- **Arhitectură Multi-Session:** Permite inițializarea manuală de conturi multiple via `sessionId` distinct controlat prin param.
- **Persistență Nativă a Sesiunilor:** Toate sesiunile active sunt salvate automat si izolat în folderul `./session/` si repornesc automat la restartul PM2 (fără rescanarea repetată a QR-ului).
- **Rute API Securizate:** Toate rutele beneficiază de validare `x-api-key` controlată prin fișiere `.env` pentru excludere Git.
- **Integrări Webhook (3CX):** Endpoint dedicat `/3cx/event` care primește payload-urile 3CX standard și expediază alerte de apel intern direct pe chatul de WhatsApp.
- **Securitate Repository și Root:** Tokenurile GitHub au fost șterse iar istoricul rescris.
- **Support Daemon:** Include `deploy/` config files (cloud-init și bash setup) pentru generarea instanțelor pe stiva EC2/Hetzner folosind PM2 fork mode.

## Quick Start

1. Creați un fișier `.env` copiind structura din `.env.example`.
2. Asigurați-vă că folosiți Linux (cu instalarea dependențelor Chromium headless tip `libatk1.0-0`, `libnss3`, `libasound2` etc.)
3. `npm install`
4. `pm2 start index.js --name 'open-wa' && pm2 save`

## Endpoints API Expuse

_Toate request-urile necesită Header-ul `x-api-key` setat cu valoarea din `.env`._

1. **`POST /api/sessions/start`**
   - Răspunde de instanțierea procesului ascuns de Chromium pt WhatsApp.
   - Body: `{ "sessionId": "nume-cont" }`

2. **`GET /api/sessions/status/:sessionId`**
   - Preia payload-ul de status al unei sesiuni, incluzând Hash-ul valid pentru QR code în vederea scanării remote via Postman.

3. **`POST /api/messages/send`**
   - Transmite mesaje directe.
   - Body: `{ "sessionId": "nume-cont", "to": "407XXX...", "text": "Mesaj aici" }`

4. **`POST /3cx/event`**
   - Webhook bridge pentru 3CX cu recunoaștere JSON events (ex: `call_incoming`). Se aplică automat pe primul WhatsApp conectat sau pe `sessionId` specificat în payload.

5. **`GET /health`**
   - Validare Node uptime și monitorizare map-pool (statistici memorie).
