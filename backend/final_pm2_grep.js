const { execSync } = require('child_process');

try {
    console.log("=== EXACT PM2 LOG TRACE FOR T3 MSG ===");
    const uuid = "ee16c96f-1266-4fc9-a7f5-a2c22377cf4e";
    console.log(`Searching PM2 wa-api buffer for ${uuid}...`);
    
    // Find lines specifically mentioning the UUID and identity resolution
    const logs = execSync(`pm2 logs wa-api --lines 5000 --nostream | grep -C 10 "${uuid}"`).toString();
    console.log(logs);
    
    console.log("\nSearching for any traces of SESSION_B5743B...");
    try {
        const badLogs = execSync(`pm2 logs wa-api --lines 5000 --nostream | grep "SESSION_B5743B"`).toString();
        console.log("FOUND!");
        console.log(badLogs);
    } catch(e) {
         console.log("No SESSION_B5743B traces found. Memory is clean.");
    }
} catch(e) {
    console.log("Grep failed or zero results in immediate buffer.");
}
