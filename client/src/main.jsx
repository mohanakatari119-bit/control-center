import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NavLink, Route, BrowserRouter as Router, Routes, useSearchParams } from "react-router-dom";
import logoUrl from "./logo.png";
import "./styles.css";

const currency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function useSnapshot() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function refresh({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      setError("");
      setSnapshot(await api("/api/snapshot"));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh({ silent: true }), 60000);
    return () => window.clearInterval(timer);
  }, []);

  return { snapshot, error, loading, refresh };
}

function App() {
  const { snapshot, error, loading, refresh } = useSnapshot();
  return (
    <Router>
      <Shell snapshot={snapshot} loading={loading} refresh={refresh}>
        {error ? <Toast message={error} /> : null}
        <Routes>
          <Route path="/" element={<Overview snapshot={snapshot} refresh={refresh} loading={loading} />} />
          <Route path="/github" element={<GitHubPage snapshot={snapshot} refresh={refresh} loading={loading} />} />
          <Route path="/providers" element={<ProvidersPage snapshot={snapshot} refresh={refresh} loading={loading} />} />
          <Route path="/auth" element={<SettingsPage snapshot={snapshot} refresh={refresh} loading={loading} />} />
          <Route path="/settings" element={<SettingsPage snapshot={snapshot} refresh={refresh} loading={loading} />} />
        </Routes>
      </Shell>
    </Router>
  );
}

function Shell({ snapshot, loading, refresh, children }) {
  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark image-mark">
            <img src={logoUrl} alt="Control Center logo" />
          </div>
          <div>
            <strong>Control Center</strong>
            <span>Read-only monitoring</span>
          </div>
        </div>
        <nav className="nav" aria-label="Primary navigation">
          <NavLink to="/">Overview</NavLink>
          <NavLink to="/github">GitHub</NavLink>
          <NavLink to="/providers">AI Usage</NavLink>
          <NavLink to="/auth">Auth</NavLink>
        </nav>
        <div className="profile-card">
          <span className="status-dot" />
          <div>
            <strong>{snapshot?.settings.githubUser || "Local Workspace"}</strong>
            <span>{snapshot?.lastRefresh ? `Updated ${new Date(snapshot.lastRefresh).toLocaleTimeString()}` : "Waiting for refresh"}</span>
          </div>
        </div>
      </aside>
      <main>
        {children}
      </main>
    </>
  );
}

function Topbar({ eyebrow, title, actions }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="topbar-actions">{actions}</div> : null}
    </header>
  );
}

function Metric({ label, value, detail }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <div className="contribution-preview" aria-hidden="true">
        {Array.from({ length: 35 }, (_, index) => (
          <span key={index} className={`cell level-${index % 5}`} />
        ))}
      </div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function Overview({ snapshot, refresh, loading }) {
  const gh = snapshot?.github.summary || {};
  const ai = snapshot?.ai.summary || {};
  return (
    <>
      <Topbar
        eyebrow="Realtime command surface"
        title="Read-only monitoring for GitHub activity, AI usage, and billing."
        actions={
          <>
            <button className="ghost-btn" disabled={loading} onClick={() => refresh()}>{loading ? "Refreshing" : "Refresh"}</button>
            <NavLink className="primary-link provider-key-link" to="/auth">Auth</NavLink>
          </>
        }
      />
      <section className="section-grid metrics-grid">
        <Metric label="Open PRs" value={gh.openPrs || 0} detail="GitHub live sync" />
        <Metric label="Open Issues" value={gh.openIssues || 0} detail="Across loaded repositories" />
        <Metric label="AI Spend" value={currency(ai.totalSpend)} detail="Last 31 days monitored" />
        <Metric label="Alerts" value={snapshot?.alerts.length || 0} detail="Provider and billing checks" />
      </section>
      <section className="content-grid">
        <Panel eyebrow="Live providers" title="Provider Status">
          <ProviderStatus snapshot={snapshot} />
        </Panel>
        <Panel eyebrow="Attention" title="Alerts">
          <Alerts snapshot={snapshot} />
        </Panel>
      </section>
      <section className="content-grid">
        <Panel eyebrow="GitHub" title="Repository Queue" action={<NavLink className="ghost-link" to="/github">Open GitHub</NavLink>}>
          <RepoList repos={(snapshot?.github.repos || []).slice(0, 5)} />
        </Panel>
        <Panel eyebrow="Usage" title="Daily AI Cost" action={<NavLink className="ghost-link" to="/providers">Open Usage</NavLink>}>
          <UsageChart days={snapshot?.ai.dailyCosts || []} />
        </Panel>
      </section>
    </>
  );
}

function GitHubPage({ snapshot, refresh, loading }) {
  const [filter, setFilter] = useState("all");
  const repos = snapshot?.github.repos || [];
  const filtered = filter === "all" ? repos : repos.filter((repo) => repo.status === filter);
  const gh = snapshot?.github.summary || {};
  return (
    <>
      <Topbar
        eyebrow="GitHub management"
        title="Repositories, pull requests, issues, and workflow status."
        actions={<><button className="ghost-btn" disabled={loading} onClick={() => refresh()}>{loading ? "Refreshing" : "Refresh"}</button><NavLink className="primary-link" to="/auth">GitHub Auth</NavLink></>}
      />
      <section className="section-grid metrics-grid">
        <Metric label="Repositories" value={gh.repoCount || 0} detail="Loaded from API" />
        <Metric label="Open PRs" value={gh.openPrs || 0} detail="Review queue" />
        <Metric label="Open Issues" value={gh.openIssues || 0} detail="Non-PR issues" />
        <Metric label="Blocked" value={gh.blockedRepos || 0} detail="Failing latest workflow" />
      </section>
      <section className="panel wide">
        <div className="panel-header">
          <div><p className="eyebrow">Repository queue</p><h2>Live GitHub Data</h2></div>
          <div className="segmented">
            {["all", "blocked", "review"].map((item) => (
              <button key={item} className={`segment ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>{item}</button>
            ))}
          </div>
        </div>
        <RepoList repos={filtered} />
      </section>
    </>
  );
}

function ProvidersPage({ snapshot, refresh, loading }) {
  const ai = snapshot?.ai.summary || {};
  return (
    <>
      <Topbar
        eyebrow="Provider usage"
        title="Read-only OpenAI, Claude, and manually tracked plan spend."
        actions={<><button className="ghost-btn" disabled={loading} onClick={() => refresh()}>{loading ? "Refreshing" : "Refresh"}</button><NavLink className="primary-link" to="/auth">Provider Auth</NavLink></>}
      />
      <section className="section-grid metrics-grid">
        <Metric label="Total AI Spend" value={currency(ai.totalSpend)} detail="Last 31 days monitored" />
        <Metric label="OpenAI" value={currency(ai.openaiSpend)} detail="OpenAI Auth cost fetch" />
        <Metric label="Claude" value={currency(ai.anthropicSpend)} detail="Claude Auth cost fetch" />
        <Metric label="Tracked Plans" value={currency(ai.subscriptionSpend)} detail="Manual monitoring entries" />
      </section>
      <section className="content-grid">
        <Panel eyebrow="Daily cost" title="Last 31 Days" wide>
          <UsageChart days={snapshot?.ai.dailyCosts || []} />
        </Panel>
        <Panel eyebrow="Providers" title="Status">
          <ProviderStatus snapshot={snapshot} />
        </Panel>
      </section>
      <ManualPlans snapshot={snapshot} refresh={refresh} />
      <UsageRecords snapshot={snapshot} refresh={refresh} />
    </>
  );
}

function SettingsPage({ snapshot, refresh }) {
  const [form, setForm] = useState({ githubToken: "", openaiKey: "", anthropicKey: "" });
  const [message, setMessage] = useState("");
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("connected") === "github") setMessage("GitHub login connected");
    if (searchParams.get("error") === "missing_github_oauth_config") {
      setMessage("Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the backend to enable GitHub login");
    }
    if (searchParams.get("error") === "invalid_github_oauth_state") setMessage("GitHub login failed state validation");
  }, [searchParams]);

  async function submit(event) {
    event.preventDefault();
    await api("/api/settings", { method: "POST", body: JSON.stringify(form) });
    setForm((current) => ({ ...current, githubToken: "", openaiKey: "", anthropicKey: "" }));
    setMessage("Provider auth saved on local server");
    await refresh({ silent: true });
  }

  async function reset() {
    if (!window.confirm("Reset local auth, subscriptions, and usage records?")) return;
    await api("/api/reset", { method: "POST" });
    setMessage("Local monitoring store reset");
    await refresh({ silent: true });
  }

  function exportData() {
    window.location.href = "/api/export";
  }

  async function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const payload = JSON.parse(await file.text());
    await api("/api/import", { method: "POST", body: JSON.stringify(payload) });
    setMessage("Imported local monitoring data");
    event.target.value = "";
    await refresh({ silent: true });
  }

  return (
    <>
      <Topbar eyebrow="Auth" title="Connect provider auth for monitoring." actions={<button className="ghost-btn" onClick={() => refresh()}>Refresh</button>} />
      {message ? <Toast message={message} /> : null}
      <section className="auth-grid">
        <AuthCard
          name="GitHub"
          detail="Use GitHub OAuth login for repository monitoring."
          loginHref="/api/auth/github/start"
          loginLabel="Login with GitHub"
        />
        <AuthCard
          name="OpenAI"
          detail="OpenAI usage APIs require API key auth. Sign in, create/copy a key, then paste it below."
          href="https://platform.openai.com/api-keys"
        />
        <AuthCard
          name="Claude"
          detail="Claude usage APIs require API key auth. Sign in, create/copy a key, then paste it below."
          href="https://console.anthropic.com/settings/keys"
        />
      </section>
      <section className="panel wide">
        <div className="panel-header"><div><p className="eyebrow">Paste auth</p><h2>Provider Auth</h2></div></div>
        <form className="settings-form settings-grid" onSubmit={submit}>
          <label>GitHub Auth<input value={form.githubToken} type="password" autoComplete="off" placeholder="Leave blank to keep existing" onChange={(event) => setForm({ ...form, githubToken: event.target.value })} /></label>
          <label>OpenAI Auth<input value={form.openaiKey} type="password" autoComplete="off" placeholder="Leave blank to keep existing" onChange={(event) => setForm({ ...form, openaiKey: event.target.value })} /></label>
          <label>Claude Auth<input value={form.anthropicKey} type="password" autoComplete="off" placeholder="Leave blank to keep existing" onChange={(event) => setForm({ ...form, anthropicKey: event.target.value })} /></label>
          <button className="primary-btn" type="submit">Save Auth</button>
        </form>
        <div className="control-row">
          <button className="ghost-btn" onClick={() => refresh()}>Test Connections</button>
          <button className="ghost-btn" onClick={exportData}>Export JSON</button>
          <label className="ghost-btn file-button">Import JSON<input type="file" accept="application/json" onChange={importData} /></label>
          <button className="danger-btn" onClick={reset}>Reset Local Store</button>
        </div>
      </section>
      <Panel eyebrow="Connection state" title="Current Status">
        <ProviderStatus snapshot={snapshot} />
      </Panel>
    </>
  );
}

function Panel({ eyebrow, title, action, children, wide }) {
  return (
    <article className={`panel ${wide ? "wide" : ""}`}>
      <div className="panel-header">
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
        {action}
      </div>
      {children}
    </article>
  );
}

function ProviderStatus({ snapshot }) {
  const providers = snapshot?.providers || [];
  if (!providers.length) return <EmptyState title="No provider status" detail="Refresh to load monitoring connection state." />;
  return (
    <div className="provider-grid">
      {providers.map((provider) => (
        <article className="provider-card" key={provider.name}>
          <div><strong>{provider.name}</strong><span>{provider.detail}</span></div>
          <span className={`pill ${provider.connected ? "good" : "warn"}`}>{provider.connected ? "connected" : "missing"}</span>
          {provider.error ? <p className="provider-error">{provider.error}</p> : null}
          {!provider.connected ? <NavLink className="ghost-link provider-auth-link" to="/auth">Authenticate</NavLink> : null}
        </article>
      ))}
    </div>
  );
}

function AuthCard({ name, detail, href, loginHref, loginLabel }) {
  return (
    <article className="auth-card">
      <div>
        <p className="eyebrow">Provider auth</p>
        <h2>{name}</h2>
        <span>{detail}</span>
      </div>
      <div className="auth-actions">
        {loginHref ? <a className="primary-link" href={loginHref}>{loginLabel}</a> : null}
        {href ? <a className={loginHref ? "ghost-link" : "primary-link"} href={href} target="_blank" rel="noreferrer">Sign in / Get Key</a> : null}
      </div>
    </article>
  );
}

function Alerts({ snapshot }) {
  const alerts = snapshot?.alerts || [];
  if (!alerts.length) return <EmptyState title="No alerts" detail="Provider, billing, and GitHub alerts will appear here." />;
  return (
    <div className="alert-list">
      {alerts.map((alert) => (
        <article className="alert-item" key={`${alert.title}-${alert.detail}`}>
          <span className={`pill ${alert.severity}`}>{alert.severity}</span>
          <strong>{alert.title}</strong>
          <span>{alert.detail}</span>
        </article>
      ))}
    </div>
  );
}

function RepoList({ repos }) {
  if (!repos.length) return <EmptyState title="No repositories loaded" detail="Add GitHub Auth in the Auth tab and refresh." />;
  return (
    <div className="repo-list">
      {repos.map((repo) => (
        <article className="repo-card" key={repo.id || repo.fullName}>
          <div className="repo-title-row"><h3>{repo.fullName}</h3><a href={repo.url} target="_blank" rel="noreferrer">Open</a></div>
          <p>{repo.note}</p>
          <div className="repo-actions">
            <div className="repo-meta"><span>{repo.prs} PRs</span><span>{repo.issues} issues</span><span>{repo.checks}</span><span>Updated {new Date(repo.updatedAt).toLocaleDateString()}</span></div>
            <span className={`pill ${repo.status === "blocked" ? "bad" : repo.status === "review" ? "warn" : "good"}`}>{repo.status}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function UsageChart({ days }) {
  const max = Math.max(...days.map((day) => day.total), 0);
  if (!days.some((day) => day.total > 0)) {
    return (
      <div className="usage-chart">
        <div className="usage-empty">
          <div className="heatmap">{Array.from({ length: 84 }, (_, index) => <span key={index} className={`cell level-${index % 5}`} />)}</div>
          <strong>No provider cost data yet</strong>
          <span>Add OpenAI Auth or Claude Auth in the Auth tab.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="usage-chart">
      {days.map((day) => {
        const height = Math.max(8, Math.round((day.total / max) * 100));
        return <div className="bar" key={day.date} style={{ height: `${height}%` }} data-label={new Date(day.date).getDate()} title={`${day.date}: ${currency(day.total)}`} />;
      })}
    </div>
  );
}

function ManualPlans({ snapshot, refresh }) {
  const [modal, setModal] = useState(false);
  const plans = snapshot?.subscriptions || [];
  async function remove(id) {
    await api(`/api/subscriptions/${id}`, { method: "DELETE" });
    await refresh({ silent: true });
  }
  return (
    <section className="panel">
      <div className="panel-header"><div><p className="eyebrow">Manual tracking</p><h2>Plan Cost Records</h2></div><button className="ghost-btn" onClick={() => setModal(true)}>Add Record</button></div>
      {!plans.length ? <EmptyState title="No manual cost records" detail="Add read-only cost records for plans that do not expose a usage API." /> : (
        <div className="subscription-list">
          {plans.map((plan) => (
            <article className="subscription-row" key={plan.id}>
              <div className="row-main"><strong>{plan.name}</strong><span>{plan.provider} - renews {plan.renewal || "not set"}</span><div className="progress"><span style={{ width: `${Math.max(0, Math.min(100, Number(plan.usage || 0)))}%` }} /></div></div>
              <span className="pill">{currency(plan.cost)}</span>
              <button className="danger-btn compact" onClick={() => remove(plan.id)}>Remove</button>
            </article>
          ))}
        </div>
      )}
      {modal ? <PlanModal onClose={() => setModal(false)} refresh={refresh} /> : null}
    </section>
  );
}

function UsageRecords({ snapshot, refresh }) {
  const [modal, setModal] = useState(false);
  const records = snapshot?.usageRecords || [];
  async function remove(id) {
    await api(`/api/usage-records/${id}`, { method: "DELETE" });
    await refresh({ silent: true });
  }
  return (
    <section className="panel">
      <div className="panel-header"><div><p className="eyebrow">Manual usage</p><h2>Monthly Usage Records</h2></div><button className="ghost-btn" onClick={() => setModal(true)}>Add Usage</button></div>
      {!records.length ? <EmptyState title="No manual usage records" detail="Add usage entries for providers or tools without supported usage APIs." /> : (
        <div className="subscription-list">
          {records.map((record) => (
            <article className="subscription-row" key={record.id}>
              <div className="row-main"><strong>{record.provider}</strong><span>{record.date || "No date"} - {Number(record.tokens || 0).toLocaleString()} tokens</span></div>
              <span className="pill">{currency(record.cost)}</span>
              <button className="danger-btn compact" onClick={() => remove(record.id)}>Remove</button>
            </article>
          ))}
        </div>
      )}
      {modal ? <UsageModal onClose={() => setModal(false)} refresh={refresh} /> : null}
    </section>
  );
}

function PlanModal({ onClose, refresh }) {
  const [form, setForm] = useState({ name: "", provider: "", cost: "", renewal: "", usage: "" });
  async function submit(event) {
    event.preventDefault();
    await api("/api/subscriptions", { method: "POST", body: JSON.stringify(form) });
    onClose();
    await refresh({ silent: true });
  }
  return (
    <Modal eyebrow="Manual tracking" title="Add Cost Record" onClose={onClose} onSubmit={submit}>
      <label>Record name<input value={form.name} required placeholder="Cursor Pro" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Provider<input value={form.provider} required placeholder="Cursor" onChange={(event) => setForm({ ...form, provider: event.target.value })} /></label>
      <label>Monthly cost<input value={form.cost} required type="number" placeholder="20" onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
      <label>Renewal date<input value={form.renewal} type="date" onChange={(event) => setForm({ ...form, renewal: event.target.value })} /></label>
      <label>Usage percent<input value={form.usage} required type="number" placeholder="50" onChange={(event) => setForm({ ...form, usage: event.target.value })} /></label>
    </Modal>
  );
}

function UsageModal({ onClose, refresh }) {
  const [form, setForm] = useState({ provider: "", date: new Date().toISOString().slice(0, 10), tokens: "", cost: "" });
  async function submit(event) {
    event.preventDefault();
    await api("/api/usage-records", { method: "POST", body: JSON.stringify(form) });
    onClose();
    await refresh({ silent: true });
  }
  return (
    <Modal eyebrow="Manual usage" title="Add Usage Record" onClose={onClose} onSubmit={submit}>
      <label>Provider<input value={form.provider} required placeholder="OpenRouter" onChange={(event) => setForm({ ...form, provider: event.target.value })} /></label>
      <label>Date<input value={form.date} required type="date" onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
      <label>Tokens<input value={form.tokens} required type="number" placeholder="100000" onChange={(event) => setForm({ ...form, tokens: event.target.value })} /></label>
      <label>Cost<input value={form.cost} required type="number" placeholder="12.50" onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
    </Modal>
  );
}

function Modal({ eyebrow, title, onClose, onSubmit, children }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal-card modal-mounted" onSubmit={onSubmit}>
        <div className="panel-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>x</button></div>
        <div className="modal-fields">{children}</div>
        <div className="modal-actions"><button className="ghost-btn" type="button" onClick={onClose}>Close</button><button className="primary-btn" type="submit">Save</button></div>
      </form>
    </div>
  );
}

function Toast({ message }) {
  return <div className="toast visible" role="status">{message}</div>;
}

createRoot(document.getElementById("root")).render(<App />);
