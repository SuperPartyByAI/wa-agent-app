async function run() {
  const token = "sbp_e6259430930c986b34be6053fed038e6da77b5d5";
  const ref = "jrfhprnuxxfwkwjwdsez"; // Main project

  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: 'SELECT 1 as result;' })
    });

    if (!response.ok) {
      console.error("FAIL:", await response.text());
    } else {
      console.log("[SUCCESS] Management API active! Result:", await response.text());
    }
  } catch (error) {
    console.error("Error:", error);
  }
}
run();
