const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const FROM = `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`;
const TO = `whatsapp:${process.env.ADMIN_PH_NO}`;

const URL = "https://apply.careers.microsoft.com/careers?domain=microsoft.com&hl=en&start=0&location=Ireland&sort_by=match&filter_include_remote=1&filter_employment_type=full-time&filter_roletype=individual+contributor&filter_profession=software+engineering&filter_seniority=Entry";

const CACHE_FILE = "noti_cache_jobs.json";

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

function extractJobIds(html) {
  const jobIds = [];
  const regex = /data-job-id="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    jobIds.push(match[1]);
  }

  if (jobIds.length === 0) {
    const altRegex = /job[_-]id["\s:=]+([a-zA-Z0-9_-]+)/gi;
    while ((match = altRegex.exec(html)) !== null) {
      jobIds.push(match[1]);
    }
  }

  return [...new Set(jobIds)];
}

function loadOldJobs() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const data = fs.readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Cache parse error:", err.message);
    return null;
  }
}

function saveJobs(jobs) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ jobs, timestamp: new Date().toISOString() }, null, 2), "utf8");
}

async function sendWhatsApp(msg) {
  try {
    await client.messages.create({ body: msg, from: FROM, to: TO });
    console.log("WhatsApp sent:", msg);
  } catch (err) {
    console.error("Failed to send WhatsApp:", err.message);
  }
}

async function check() {
  try {
    console.log(`[${new Date().toISOString()}] Checking for job changes...`);
    const html = await fetchPage();
    const currentJobs = extractJobIds(html);

    if (currentJobs.length === 0) {
      console.warn("No jobs found - page structure may have changed or page failed to load properly");
      return;
    }

    console.log(`Found ${currentJobs.length} jobs on page`);

    const oldData = loadOldJobs();

    if (!oldData) {
      console.log("First run - saving initial job list");
      saveJobs(currentJobs);
      await sendWhatsApp(`Job monitor started. Tracking ${currentJobs.length} jobs at Microsoft Ireland.`);
      return;
    }

    const oldJobs = oldData.jobs || [];
    const newJobsAdded = currentJobs.filter(id => !oldJobs.includes(id));
    const jobsRemoved = oldJobs.filter(id => !currentJobs.includes(id));

    if (newJobsAdded.length > 0 || jobsRemoved.length > 0) {
      console.log("Change detected!");
      console.log(`- New jobs: ${newJobsAdded.length}`);
      console.log(`- Removed jobs: ${jobsRemoved.length}`);

      saveJobs(currentJobs);

      let message = "Microsoft Ireland Jobs Update:\n\n";
      if (newJobsAdded.length > 0) {
        message += `✅ ${newJobsAdded.length} new job(s) posted\n`;
      }
      if (jobsRemoved.length > 0) {
        message += `❌ ${jobsRemoved.length} job(s) removed\n`;
      }
      message += `\nTotal jobs: ${currentJobs.length}\n\n${URL}`;

      await sendWhatsApp(message);
    } else {
      console.log("No changes detected");
    }
  } catch (err) {
    console.error("Monitor error:", err.message);
    await sendWhatsApp(`⚠️ Job monitor error: ${err.message}`);
  }
}

console.log("Job monitor initialized. Checking every 30 minutes...");
check();
setInterval(check, 1000 * 60 * 30); 
