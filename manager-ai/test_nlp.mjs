import fetch from 'node-fetch';

async function testMsg() {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "109863482181532",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "40316315509",
                phone_number_id: "102871146209503"
              },
              contacts: [
                {
                  profile: {
                    name: "Univers Party"
                  },
                  wa_id: "40742525110"
                }
              ],
              messages: [
                {
                  from: "40742525110",
                  id: "wamid.HBgLNDA3NDI1MjUxMTAVAhgGNDYyNjM1NkYwMEQwMjRBMEVF" + Math.random(),
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: {
                    body: "Eu nu zic vreau oferta. am o fetita de 5 ani si vreau sa ii fac ziua de nastere dar nu stiu exact ce mi se potriveste. zi-mi si mie cat te costa sa vii cu printesa elsa"
                  },
                  type: "text"
                }
              ]
            },
            field: "messages"
          }
        ]
      }
    ]
  };

  try {
    console.log("Sending simulated message...");
    const res = await fetch("http://localhost:3000/webhook", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload) // Need to send to wa-api to get recorded and webhooked to manager-ai
    });
    console.log("WA-API Response:", res.status);
  } catch(e) { console.error(e); }
}

testMsg();
