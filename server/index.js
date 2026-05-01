import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || "127.0.0.1";
const STORE_PATH = process.env.STORE_PATH || path.join(ROOT_DIR, "data", "control-center.json");
const DIST_PATH = path.join(ROOT_DIR, "dist");
const oauthStates = new Map();

const defaultStore = {
  settings: {
    githubToken: process.env.GITHUB_AUTH || process.env.GITHUB_TOKEN || "",
    openaiKey: process.env.OPENAI_AUTH || process.env.OPENAI_ADMIN_KEY || "",
    anthropicKey: process.env.CLAUDE_AUTH || process.env.ANTHROPIC_ADMIN_KEY || "",
    githubUser: "",
  },
  subscriptions: [],
  usageRecords: [],
};

let liveCache = {
  github: { repos: [], summary: { repoCount: 0, openPrs: 0, openIssues: 0, blockedRepos: 0 }, error: "" },
  ai: {
    dailyCosts: [],
    summary: { totalSpend: 0, openaiSpend: 0, anthropicSpend: 0, subscriptionSpend: 0 },
    errors: {},
  },
  lastRefresh: "",
};

function readStore() {
  try {
    return mergeStore(JSON.parse(fs.readFileSync(STORE_PATH, "utf8")));
  } catch {
    return structuredClone(defaultStore);
  }
}

function mergeStore(store) {
  return {
    settings: { ...defaultStore.settings, ...(store.settings || {}) },
    subscriptions: Array.isArray(store.subscriptions) ? store.subscriptions : [],
    usageRecords: Array.isArray(store.usageRecords) ? store.usageRecords : [],
  };
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(mergeStore(store), null, 2));
}

async function providerFetch(url, headers) {
  const response = await fetch(url, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.error?.message || `${response.status} ${response.statusText}`);
  }
  return body;
}

function monthRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

function emptyDailyCosts() {
  const { start } = monthRange();
  return Array.from({ length: 31 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), openai: 0, anthropic: 0, subscriptions: 0, total: 0 };
  });
}

function addCost(daily, dateLike, provider, amount) {
  const key = new Date(dateLike).toISOString().slice(0, 10);
  const row = daily.find((item) => item.date === key);
  if (!row) return;
  row[provider] += Number(amount || 0);
  row.total += Number(amount || 0);
}

async function fetchGitHub(store) {
  if (!store.settings.githubToken) {
    return { repos: [], summary: { repoCount: 0, openPrs: 0, openIssues: 0, blockedRepos: 0 }, error: "Missing GitHub auth" };
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${store.settings.githubToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "control-center-local",
  };

  const user = await providerFetch("https://api.github.com/user", headers);
  store.settings.githubUser = user.login;
  const repos = await providerFetch(
    "https://api.github.com/user/repos?per_page=30&sort=pushed&affiliation=owner,collaborator,organization_member",
    headers,
  );

  const mapped = await Promise.all(
    repos.slice(0, 18).map(async (repo) => {
      const [pulls, issues, runs] = await Promise.all([
        providerFetch(`https://api.github.com/repos/${repo.full_name}/pulls?state=open&per_page=100`, headers).catch(() => []),
        providerFetch(`https://api.github.com/repos/${repo.full_name}/issues?state=open&per_page=100`, headers).catch(() => []),
        providerFetch(`https://api.github.com/repos/${repo.full_name}/actions/runs?per_page=1`, headers).catch(() => ({ workflow_runs: [] })),
      ]);
      const latestRun = runs.workflow_runs?.[0];
      const openIssues = issues.filter((issue) => !issue.pull_request).length;
      const status = latestRun?.conclusion === "failure" ? "blocked" : pulls.length ? "review" : "clear";
      return {
        id: repo.id,
        fullName: repo.full_name,
        url: repo.html_url,
        prs: pulls.length,
        issues: openIssues,
        checks: latestRun ? `${latestRun.conclusion || latestRun.status} workflow` : "no workflow runs",
        status,
        updatedAt: repo.pushed_at || repo.updated_at,
        note: repo.description || "No repository description set.",
      };
    }),
  );

  return {
    repos: mapped.sort((a, b) => b.prs - a.prs || b.issues - a.issues),
    summary: {
      repoCount: mapped.length,
      openPrs: mapped.reduce((sum, repo) => sum + repo.prs, 0),
      openIssues: mapped.reduce((sum, repo) => sum + repo.issues, 0),
      blockedRepos: mapped.filter((repo) => repo.status === "blocked").length,
    },
    error: "",
  };
}

async function fetchOpenAI(store, daily) {
  if (!store.settings.openaiKey) throw new Error("Missing OpenAI auth");
  const { start, end } = monthRange();
  const params = new URLSearchParams({
    start_time: String(Math.floor(start.getTime() / 1000)),
    end_time: String(Math.floor(end.getTime() / 1000)),
    bucket_width: "1d",
    limit: "31",
  });
  const data = await providerFetch(`https://api.openai.com/v1/organization/costs?${params}`, {
    Authorization: `Bearer ${store.settings.openaiKey}`,
    "Content-Type": "application/json",
  });
  let total = 0;
  for (const bucket of data.data || []) {
    for (const result of bucket.results || []) {
      const amount = Number(result.amount?.value || 0);
      total += amount;
      addCost(daily, bucket.start_time * 1000, "openai", amount);
    }
  }
  return total;
}

async function fetchAnthropic(store, daily) {
  if (!store.settings.anthropicKey) throw new Error("Missing Claude auth");
  const { start, end } = monthRange();
  const params = new URLSearchParams({
    starting_at: start.toISOString(),
    ending_at: end.toISOString(),
    limit: "31",
  });
  const data = await providerFetch(`https://api.anthropic.com/v1/organizations/cost_report?${params}`, {
    "x-api-key": store.settings.anthropicKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  });
  let total = 0;
  for (const bucket of data.data || []) {
    for (const result of bucket.results || []) {
      const amount = Number(result.amount || 0);
      total += amount;
      addCost(daily, bucket.starting_at, "anthropic", amount);
    }
  }
  return total;
}

function buildAlerts(store, github, errors) {
  const alerts = [];
  if (github.error) alerts.push({ severity: "warn", title: "GitHub sync unavailable", detail: github.error });
  if (github.summary.blockedRepos) alerts.push({ severity: "bad", title: "Blocked GitHub repositories", detail: `${github.summary.blockedRepos} repositories have failing latest workflows.` });
  if (errors.openai) alerts.push({ severity: "warn", title: "OpenAI usage unavailable", detail: errors.openai });
  if (errors.anthropic) alerts.push({ severity: "warn", title: "Claude usage unavailable", detail: errors.anthropic });
  return alerts;
}

function publicSnapshot(store, alerts) {
  return {
    settings: {
      githubUser: store.settings.githubUser,
    },
    providers: [
      { name: "GitHub", connected: Boolean(store.settings.githubToken), detail: store.settings.githubUser || "GitHub Auth for repos, issues, PRs, workflows", error: liveCache.github.error },
      { name: "OpenAI", connected: Boolean(store.settings.openaiKey), detail: "OpenAI Auth for organization costs", error: liveCache.ai.errors.openai || "" },
      { name: "Claude", connected: Boolean(store.settings.anthropicKey), detail: "Claude Auth for Usage & Cost Admin API", error: liveCache.ai.errors.anthropic || "" },
    ],
    github: liveCache.github,
    ai: liveCache.ai,
    subscriptions: store.subscriptions,
    usageRecords: store.usageRecords,
    alerts,
    lastRefresh: liveCache.lastRefresh,
  };
}

async function buildSnapshot() {
  const store = readStore();
  const daily = emptyDailyCosts();
  const errors = {};
  let github;
  let openaiSpend = 0;
  let anthropicSpend = 0;

  try {
    github = await fetchGitHub(store);
  } catch (error) {
    github = { repos: [], summary: { repoCount: 0, openPrs: 0, openIssues: 0, blockedRepos: 0 }, error: error.message };
  }

  try {
    openaiSpend = await fetchOpenAI(store, daily);
  } catch (error) {
    errors.openai = error.message;
  }

  try {
    anthropicSpend = await fetchAnthropic(store, daily);
  } catch (error) {
    errors.anthropic = error.message;
  }

  const subscriptionSpend = store.subscriptions.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const usageSpend = store.usageRecords.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  if (subscriptionSpend) {
    const row = daily.find((item) => item.date === new Date().toISOString().slice(0, 10)) || daily[daily.length - 1];
    row.subscriptions += subscriptionSpend;
    row.total += subscriptionSpend;
  }
  for (const usage of store.usageRecords) {
    addCost(daily, usage.date || new Date(), "subscriptions", Number(usage.cost || 0));
  }

  const totalSpend = openaiSpend + anthropicSpend + subscriptionSpend + usageSpend;
  const alerts = buildAlerts(store, github, errors);
  liveCache = {
    github,
    ai: {
      dailyCosts: daily,
      summary: { totalSpend, openaiSpend, anthropicSpend, subscriptionSpend },
      errors,
    },
    lastRefresh: new Date().toISOString(),
  };
  writeStore(store);
  return publicSnapshot(store, alerts);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function appBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/snapshot", async (_req, res, next) => {
  try {
    res.json(await buildSnapshot());
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/github/start", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.redirect("/auth?error=missing_github_oauth_config");
    return;
  }

  const state = crypto.randomBytes(18).toString("hex");
  oauthStates.set(state, Date.now());
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appBaseUrl(req)}/api/auth/github/callback`,
    scope: process.env.GITHUB_OAUTH_SCOPE || "read:user repo",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get("/api/auth/github/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || !oauthStates.has(state)) {
      res.redirect("/auth?error=invalid_github_oauth_state");
      return;
    }
    oauthStates.delete(state);

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${appBaseUrl(req)}/api/auth/github/callback`,
      }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description || payload.error || "GitHub OAuth token exchange failed");
    }

    const store = readStore();
    store.settings.githubToken = payload.access_token;
    writeStore(store);
    res.redirect("/auth?connected=github");
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", (req, res) => {
  const store = readStore();
  if (req.body.githubToken) store.settings.githubToken = req.body.githubToken;
  if (req.body.openaiKey) store.settings.openaiKey = req.body.openaiKey;
  if (req.body.anthropicKey) store.settings.anthropicKey = req.body.anthropicKey;
  writeStore(store);
  res.json({ ok: true });
});

app.post("/api/subscriptions", (req, res) => {
  const store = readStore();
  store.subscriptions.push({
    id: id("record"),
    name: req.body.name,
    provider: req.body.provider,
    cost: Number(req.body.cost || 0),
    renewal: req.body.renewal,
    usage: Number(req.body.usage || 0),
  });
  writeStore(store);
  res.json({ ok: true });
});

app.delete("/api/subscriptions/:id", (req, res) => {
  const store = readStore();
  store.subscriptions = store.subscriptions.filter((item) => item.id !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});

app.post("/api/usage-records", (req, res) => {
  const store = readStore();
  store.usageRecords.push({
    id: id("usage"),
    provider: req.body.provider,
    date: req.body.date,
    tokens: Number(req.body.tokens || 0),
    cost: Number(req.body.cost || 0),
  });
  writeStore(store);
  res.json({ ok: true });
});

app.delete("/api/usage-records/:id", (req, res) => {
  const store = readStore();
  store.usageRecords = store.usageRecords.filter((item) => item.id !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});

app.post("/api/reset", (_req, res) => {
  writeStore(structuredClone(defaultStore));
  liveCache = {
    github: { repos: [], summary: { repoCount: 0, openPrs: 0, openIssues: 0, blockedRepos: 0 }, error: "" },
    ai: { dailyCosts: [], summary: { totalSpend: 0, openaiSpend: 0, anthropicSpend: 0, subscriptionSpend: 0 }, errors: {} },
    lastRefresh: "",
  };
  res.json({ ok: true });
});

app.get("/api/export", (_req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=\"control-center-export.json\"");
  res.json(readStore());
});

app.post("/api/import", (req, res) => {
  writeStore(mergeStore(req.body || {}));
  res.json({ ok: true });
});

app.use(express.static(DIST_PATH));
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(DIST_PATH, "index.html"));
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error.message });
});

app.listen(PORT, HOST, () => {
  console.log(`Control Center API running at http://${HOST}:${PORT}/`);
});
