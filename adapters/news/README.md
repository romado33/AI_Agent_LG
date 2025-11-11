## AI News Digest (Python bridge – temporary)

The LangGraph server currently triggers `aggregate_ai_news.py` to build
daily markdown/HTML digests. This script will be reimplemented in Node,
but until then:

1. Create a private config file for Google OAuth tokens outside the repo  
   (for example: `%APPDATA%/ai-agent/news_token.json`).
2. Set the environment variable `NEWS_TOKEN_PATH` (or adjust the script)
   so it can read your credentials securely.
3. Install Python dependencies from `requirements.txt` (see script header
   for details) and ensure `python` refers to that environment.

The previous `token.json` has been removed for security. Do not commit
OAuth tokens to the repository.


