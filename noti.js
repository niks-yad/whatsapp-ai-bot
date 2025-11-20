require('dotenv').config();

const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const FROM = process.env.TWILIO_SMS_NUMBER;
const TO = process.env.ADMIN_PH_NO;

const URL = "https://apply.careers.microsoft.com/careers?domain=microsoft.com&hl=en&start=0&location=Ireland&sort_by=match&filter_include_remote=1&filter_employment_type=full-time&filter_roletype=individual+contributor&filter_profession=software+engineering&filter_seniority=Entry";

const CACHE_FILE = "noti_cache_hash.txt";
const STATE_FILE = "noti_state.json";

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { lastChangeDate: null, dailyMessageSent: false };
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (err) {
    return { lastChangeDate: null, dailyMessageSent: false };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

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

async function checkDailyMessage() {
  const state = loadState();
  const now = new Date();
  const utcHour = now.getUTCHours();
  const today = now.toISOString().split('T')[0];

  // Check if it's 8pm UTC (20:00)
  if (utcHour === 20) {
    // If no change today and message not sent yet
    if (state.lastChangeDate !== today && !state.dailyMessageSent) {
      console.log("No changes today - sending daily summary");
      await sendSMS(`Daily Update: No changes detected on Microsoft Ireland careers page today.\n\n${URL}`);
      state.dailyMessageSent = true;
      saveState(state);
    }
  } else {
    // Reset dailyMessageSent flag if it's past 8pm
    if (utcHour > 20 && state.dailyMessageSent) {
      state.dailyMessageSent = false;
      saveState(state);
    }
  }
}

async function check() {
  try {
    console.log(`[${new Date().toISOString()}] Checking for page changes...`);
    const html = await fetchPage();
    const currentHash = hashContent(html);
    const oldHash = loadOldHash();
    const state = loadState();
    const today = new Date().toISOString().split('T')[0];

    if (!oldHash) {
      console.log("First run - saving baseline hash");
      saveHash(currentHash);
      state.lastChangeDate = today;
      state.dailyMessageSent = false;
      saveState(state);
      await sendSMS(`Job monitor started for Microsoft Ireland careers page.\n\n${URL}`);
      return;
    }

    if (currentHash !== oldHash) {
      console.log("Page changed! Hash mismatch detected.");
      saveHash(currentHash);

      // Mark that we had a change today and reset daily message flag
      state.lastChangeDate = today;
      state.dailyMessageSent = true; // Prevent daily "no change" message
      saveState(state);

      await sendSMS(`Microsoft Ireland careers page has changed!\n\nSomething on the page was updated (job added/removed/modified).\n\n${URL}`);
    } else {
      console.log("No changes detected");
    }

    // Check if we need to send daily message
    await checkDailyMessage();
  } catch (err) {
    console.error("Monitor error:", err.message);
    await sendSMS(`Job monitor error: ${err.message}`);
  }
}

console.log("Job monitor initialized. Checking every 30 minutes...");
check();
setInterval(check, 1000 * 60 * 30); 
