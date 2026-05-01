# Control Center

Read-only monitoring dashboard for GitHub activity and AI usage/billing.

## What It Monitors

- GitHub repositories, open pull requests, open issues, and latest workflow status.
- OpenAI organization cost data.
- Claude/Anthropic usage and cost data.
- Manual AI subscription cost records.
- Manual AI usage records for providers that do not expose usage APIs.

This app does not chat, run agents, buy subscriptions, cancel subscriptions, upgrade plans, or modify provider accounts.

## Project Structure

```text
control-center/
  client/              React frontend
    index.html
    src/
      main.jsx
      styles.css
      logo.png
  server/              Express backend and provider API proxy
    index.js
  data/                Local persisted monitoring data
    control-center.json
  dist/                Production build output
  package.json
  vite.config.js
```

## Requirements

- Node.js 20+ recommended.
- Provider auth for the data you want to monitor.

## Auth

The Auth page is available at:

```text
http://127.0.0.1:8081/auth
```

### GitHub

GitHub supports OAuth login.

Create a GitHub OAuth App with this callback URL:

```text
http://127.0.0.1:8081/api/auth/github/callback
```

Start the server with:

```bash
GITHUB_CLIENT_ID="your_client_id" \
GITHUB_CLIENT_SECRET="your_client_secret" \
npm run start
```

You can also provide a token directly with:

```bash
GITHUB_AUTH="your_token" npm run start
```

### OpenAI

OpenAI usage/cost APIs use API key auth. Use an org/admin key that can read costs:

```bash
OPENAI_AUTH="your_openai_key" npm run start
```

### Claude

Claude/Anthropic usage and cost APIs use API key auth:

```bash
CLAUDE_AUTH="your_anthropic_key" npm run start
```

## Development

Install dependencies:

```bash
npm install
```

Run frontend and backend together:

```bash
npm run dev
```

Frontend dev server:

```text
http://127.0.0.1:5173/
```

Backend API:

```text
http://127.0.0.1:8081/
```

## Production Build

Build the React app:

```bash
npm run build
```

Start the Express backend:

```bash
npm run start
```

Open:

```text
http://127.0.0.1:8081/
```

## Data

Local monitoring data is stored in:

```text
data/control-center.json
```

The app also supports export/import/reset from the Auth page.
