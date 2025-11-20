const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const FROM = process.env.TWILIO_PHONE_NUMBER;
const TO = process.env.ADMIN_PH_NO;

const URL = "https://apply.careers.microsoft.com/careers?domain=microsoft.com&hl=en&start=0&location=Ireland&sort_by=match&filter_include_remote=1&filter_employment_type=full-time&filter_roletype=individual+contributor&filter_profession=software+engineering&filter_seniority=Entry";

const CACHE_FILE = "noti_cache_hash.txt";

async function fetchPage() {
  return new Promise((resolve, reject) => {
    const req = https.get(URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobMonitor/1.0)" },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function loadOldHash() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  return fs.readFileSync(CACHE_FILE, "utf8").trim();
}

function saveHash(hash) {
  fs.writeFileSync(CACHE_FILE, hash, "utf8");
}

async function sendSMS(msg) {
  try {
    await client.messages.create({ body: msg, from: FROM, to: TO });
    console.log("SMS notification sent");
  } catch (err) {
    console.error("Failed to send SMS:", err.message);
  }
}

async function check() {
  try {
    console.log(`[${new Date().toISOString()}] Checking for page changes...`);
    const html = await fetchPage();
    const currentHash = hashContent(html);
    const oldHash = loadOldHash();

    if (!oldHash) {
      console.log("First run - saving baseline hash");
      saveHash(currentHash);
      await sendSMS(`Job monitor started for Microsoft Ireland careers page.\n\n${URL}`);
      return;
    }

    if (currentHash !== oldHash) {
      console.log("Page changed! Hash mismatch detected.");
      saveHash(currentHash);
      await sendSMS(`Microsoft Ireland careers page has changed!\n\nSomething on the page was updated (job added/removed/modified).\n\n${URL}`);
    } else {
      console.log("No changes detected");
    }
  } catch (err) {
    console.error("Monitor error:", err.message);
    await sendSMS(`Job monitor error: ${err.message}`);
  }
}

console.log("Job monitor initialized. Checking every 30 minutes...");
check();
setInterval(check, 1000 * 60 * 30); 
