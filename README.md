## AI Agent Workbench

This project runs a LangGraph-powered agent that coordinates several
personal productivity tasks (jobs tracker, subscription tracker, weather,
sentiment checks, résumé search, AI news digest).

- `adapters/server_langgraph.js` – Express/LangGraph server
- `adapters/core/` – Shared instructions, tool definitions, storage
- `adapters/scanner/` – Node service that connects to Gmail via IMAP
- `legacy/` – Archived Python apps kept for reference (no longer primary)

### 1. Prerequisites

- Node.js ≥ 20
- Python 3.11 (only if you still run the legacy adapters or the interim
  AI news digest script)

### 2. Install dependencies

```bash
# LangGraph/Express server
cd adapters
npm install

# Gmail scanner service
cd scanner
npm install
```

### 3. Environment variables

Create an `.env` file inside `adapters/` with at least:

```
OPENAI_API_KEY=sk-...
SCANNER_BASE_URL=http://127.0.0.1:5057   # matches scanner service
PORT=3000                                # optional override

# Optional: logging, cron behaviour
LOG_LEVEL=info
NEWS_CRON_ENABLED=0
```

The scanner service expects Gmail IMAP credentials:

```
SCANNER_PORT=5057
EMAIL_USER=you@gmail.com
EMAIL_PASS=your_app_password
```

(Use an app password; do not store plain account passwords.)

### 4. Run the services

```bash
# Terminal 1 – Gmail scanner
cd adapters/scanner
npm start

# Terminal 2 – LangGraph server
cd adapters
npm run dev:langgraph
```

The server exposes `http://localhost:3000`, serving the simple workbench
UI in `adapters/public/index.html`.

### 5. Data & exports

- `adapters/data/jobs.json` / `subscriptions.json` – local storage
- `adapters/data/resumes/` – uploaded résumés (plain text)
- `exports/` – generated CSV exports (jobs import endpoint)

### 6. News digest bridge

Until the digest is reimplemented in Node, the server spawns the Python
script `adapters/news/aggregate_ai_news.py`.

Set environment variables so the script can locate OAuth credentials:

```
NEWS_CONFIG_DIR=path/to/private/config
# or provide explicit files
NEWS_TOKEN_PATH=path/to/token.json
NEWS_CREDENTIALS_PATH=path/to/credentials.json
```

The config directory is outside the repo; the old `token.json` has been
removed for security.

### 7. Legacy adapters

Legacy Python apps now live under `legacy/`:

- Gmail job tracker Streamlit UI
- FeelMap sentiment analyzer (Streamlit)
- Résumé Q&A Gradio demo
- Hollywood Weather Gradio app

They remain runnable manually but are no longer wired into the LangGraph
agent.

---

Future work: port the AI news digest to Node, enhance session handling,
add automated tests, and expand the front-end UI for the remaining tasks.


