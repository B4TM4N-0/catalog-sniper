const https = require("https");
const fs = require("fs");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const APIs = [
  {
    name: "Basic API",
    url: "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=39&Limit=30",
    outputFile: "emotedata.json"
  },
  {
    name: "Latest API",
    url: "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=39&Limit=30&salesTypeFilter=1&SortType=3",
    outputFile: "emotedata.json"
  },
  {
    name: "Animation API",
    url: "https://catalog.roproxy.com/v1/search/items/details?Category=12&Subcategory=38&salesTypeFilter=1&Limit=30",
    outputFile: "animationdata.json"
  }
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function loadData(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const items = content.data || [];
      return { items, ids: new Set(items.map((i) => i.id)) };
    }
  } catch {
    log(`Error reading ${filePath}, starting fresh`);
  }
  return { items: [], ids: new Set() };
}

function saveData(items, filePath) {
  try {
    const output = {
      keyword: null,
      totalItems: items.length,
      lastUpdate: new Date().toISOString(),
      data: items
    };
    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), "utf8");
    return true;
  } catch (err) {
    log(`Save error for ${filePath}: ${err.message}`);
    return false;
  }
}

async function fetchJSON(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
          if (res.statusCode !== 200) {
            req.destroy();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }

          let data = "";
          res.on("data", (chunk) => { data += chunk; });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error("JSON parse error"));
            }
          });
        });

        const timeout = setTimeout(() => {
          req.destroy();
          reject(new Error("Request timeout"));
        }, 30000);

        req.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function fetchUserEmotes() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log("Supabase env vars missing, skipping user emotes");
    return [];
  }

  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/rest/v1/user_emotes?select=id,name,type`;
    const req = https.request(url, {
      method: "GET",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.type || "emotes"
          })));
        } catch {
          reject(new Error("Supabase JSON parse error"));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

async function fetchAPI(api, existingData) {
  const allItems = [];
  let cursor = "";
  let page = 0;
  let newCount = 0;
  let duplicateCount = 0;

  try {
    do {
      page++;
      log(`${api.name} - Page ${page}`);

      const url = cursor ? `${api.url}&Cursor=${cursor}` : api.url;
      const res = await fetchJSON(url);

      if (!res.data || !Array.isArray(res.data)) {
        cursor = res.nextPageCursor;
        continue;
      }

      for (const item of res.data) {
        if (existingData.ids.has(item.id)) {
          duplicateCount++;
          continue;
        }

        const record = { id: item.id, name: item.name };

        if (item.bundledItems?.length) {
          const bundled = {};
          let counter = 1;
          for (const b of item.bundledItems) {
            if (b.type !== "UserOutfit" && b.id) {
              const key = String(counter++);
              bundled[key] = bundled[key] || [];
              bundled[key].push(b.id);
            }
          }
          if (Object.keys(bundled).length > 0) {
            record.bundledItems = bundled;
          }
        }

        allItems.push(record);
        existingData.ids.add(item.id);
        newCount++;
      }

      cursor = res.nextPageCursor;
      if (cursor && cursor.trim() !== "") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } while (cursor && cursor.trim() !== "");
  } catch (err) {
    log(`Error in ${api.name}: ${err.message}`);
  }

  return { items: allItems, newCount, duplicateCount };
}

async function processAPIs() {
  const start = Date.now();
  log("Starting combined update...");

  const grouped = {};
  for (const api of APIs) {
    if (!grouped[api.outputFile]) grouped[api.outputFile] = [];
    grouped[api.outputFile].push(api);
  }

  const results = {};
  const moodsData = loadData("Moods.json");

  for (const [filePath, apis] of Object.entries(grouped)) {
    log(`Processing ${filePath}...`);
    const existingData = loadData(filePath);
    const allItems = [...existingData.items];

    let newTotal = 0;
    let dupTotal = 0;

    for (const api of apis) {
      const result = await fetchAPI(api, existingData);
      allItems.push(...result.items);
      newTotal += result.newCount;
      dupTotal += result.duplicateCount;
      log(`${api.name} - New: ${result.newCount}, Duplicates: ${result.duplicateCount}`);
    }

    if (filePath === "emotedata.json") {
      try {
        const userEmotes = await fetchUserEmotes();
        let moodsNew = 0;

        for (const emote of userEmotes) {
          if (emote.type === "moods") {
            if (!moodsData.ids.has(emote.id)) {
              moodsData.items.push({ id: emote.id, name: emote.name });
              moodsData.ids.add(emote.id);
              moodsNew++;
            }
          } else if (!existingData.ids.has(emote.id)) {
            allItems.push({ id: emote.id, name: emote.name });
            existingData.ids.add(emote.id);
            newTotal++;
          }
        }
        log(`User emotes merged: ${userEmotes.length} (moods: ${moodsNew})`);
      } catch (err) {
        log(`Supabase fetch error: ${err.message}`);
      }
    }

    const saved = saveData(allItems, filePath);
    results[filePath] = { success: saved, total: allItems.length, newTotal, dupTotal };
    log(`${filePath} - Total: ${allItems.length}, New: ${newTotal}`);
  }

  const moodsSaved = saveData(moodsData.items, "Moods.json");
  results["Moods.json"] = { success: moodsSaved, total: moodsData.items.length };
  log(`Moods.json - Total: ${moodsData.items.length}`);

  const duration = ((Date.now() - start) / 1000).toFixed(2);
  log(`All updates complete - Duration: ${duration}s`);

  return results;
}

async function main() {
  log("Starting catalog-sniper update...");

  try {
    const results = await processAPIs();
    let allOk = true;

    for (const [filePath, result] of Object.entries(results)) {
      if (!result.success) {
        allOk = false;
        log(`Failed to save ${filePath}`);
      } else {
        const newCount = result.newTotal ?? 0;
        log(`✓ ${filePath}: ${result.total} items (${newCount} new)`);
      }
    }

    if (allOk) {
      log("catalog-sniper completed successfully");
      process.exit(0);
    } else {
      log("catalog-sniper completed with some errors");
      process.exit(1);
    }
  } catch (err) {
    log(`catalog-sniper error: ${err.message}`);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  log(`Unhandled error: ${reason}`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

main();
