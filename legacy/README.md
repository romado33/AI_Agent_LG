## Legacy Adapters

This directory contains the original Python-based task adapters that
preceded the LangGraph agent. They remain here for reference and for
manual, standalone runs, but the production workflow now routes through
`adapters/server_langgraph.js`.

- `jobs/` – Streamlit Gmail job tracker (supplanted by the LangGraph jobs tools and the Node scanner service).
- `sentiment/` – FeelMap Streamlit app (replaced by the built-in `analyzeSentiment` LangGraph tool).
- `resume/` – Hugging Face / Gradio résumé Q&A demo (LangGraph now handles résumé upload and querying natively).
- `weather/` – Hollywood Weather Gradio app (LangGraph weather tool uses Open-Meteo directly).

> Keep these folders for historical context or ad‑hoc experimentation,
> but prefer the LangGraph agent for day-to-day usage.



