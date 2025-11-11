# AI Agent LG - Enhanced Features Documentation

## Overview

This AI Agent has been enhanced with comprehensive features inspired by the `awesome-llm-apps` repository. It now includes persistent memory, RAG, multi-agent teams, financial coaching, research capabilities, meeting management, travel planning, social media monitoring, health tracking, and MCP integrations.

## New Features

### 1. Persistent Memory System
- **Location**: `core/memory.js`
- **Features**:
  - User preferences storage
  - Conversation history (last 50 messages)
  - Context storage
  - Facts tracking (last 100 facts)
- **API Endpoints**:
  - `GET /api/memory/:sid` - Get memory summary
  - `POST /api/memory/:sid/preference` - Update preference

### 2. RAG (Retrieval Augmented Generation)
- **Location**: `core/rag.js`
- **Features**:
  - Vector embeddings for resumes and jobs
  - Semantic search for job matching
  - Resume section retrieval
- **Requirements**: ChromaDB (optional, gracefully degrades if not available)
- **Environment**: `CHROMA_URL` (defaults to `http://localhost:8000`)

### 3. Multi-Agent Team
- **Location**: `core/multiAgent.js`
- **Agents**:
  - **Researcher**: Finds and analyzes job opportunities
  - **Matcher**: Matches resume to job descriptions using RAG
  - **Writer**: Generates cover letters and improves resumes
- **Tools**: `fullJobSearch` for complete workflow

### 4. Financial Coach
- **Location**: `core/financial.js`
- **Features**:
  - Subscription spending analysis
  - Optimization recommendations
  - ROI tracking
- **Task**: Use `task: "financial"`

### 5. Research Agent
- **Location**: `core/research.js`
- **Features**:
  - Company research
  - Role research
  - Industry trends
  - Job posting analysis
- **Task**: Use `task: "research"`

### 6. Meeting Agent
- **Location**: `core/meeting.js`
- **Features**:
  - Meeting summarization
  - Interview insights extraction
  - Follow-up email generation
- **Task**: Use `task: "meeting"`

### 7. Enhanced Travel Agent
- **Location**: `core/travel.js`
- **Features**:
  - Complete trip planning
  - Flight search (placeholder for API integration)
  - Hotel search (placeholder for API integration)
  - Travel recommendations with weather integration
- **Task**: Use `task: "travel"`

### 8. Social Media Monitoring
- **Location**: `core/social.js`
- **Features**:
  - LinkedIn job monitoring (placeholder)
  - Twitter/X monitoring (placeholder)
  - Company updates tracking
  - Job market trends analysis
- **Task**: Use `task: "social"`

### 9. Health & Productivity Tracking
- **Location**: `core/health.js`
- **Features**:
  - Work-life balance tracking
  - Break suggestions
  - Productivity metrics
- **Task**: Use `task: "health"`

### 10. MCP Integrations
- **Location**: `core/mcp.js`
- **Integrations**:
  - **GitHub MCP**: Repository search, issue tracking
  - **Browser MCP**: Web scraping, search
  - **Notion MCP**: Page creation, search (placeholder)

### 11. Callbacks & Tracking
- **Location**: `core/callbacks.js`
- **Features**:
  - Tool usage tracking
  - LLM call logging
  - Error tracking
  - Event history

### 12. Streaming Support
- **Feature**: Real-time streaming responses
- **Usage**: Set `stream: true` in chat request

## API Usage

### Chat Endpoint
```javascript
POST /chat
{
  "prompt": "Find jobs matching my resume",
  "task": "multi-agent",  // or "jobs", "financial", "research", etc.
  "sid": "user123",
  "stream": false  // Set to true for streaming
}
```

### Available Tasks
- `chat` - General chat (with memory)
- `jobs` - Job tracking with RAG
- `subs` - Subscription tracking
- `weather` - Weather queries
- `sentiment` - Sentiment analysis
- `resume` - Resume management
- `news` - AI news digest
- `financial` - Financial analysis
- `research` - Research tasks
- `meeting` - Meeting management
- `travel` - Travel planning
- `social` - Social media monitoring
- `health` - Health tracking
- `multi-agent` - Multi-agent job search

## Environment Variables

```bash
# Required
OPENAI_API_KEY=your_key_here

# Optional
CHROMA_URL=http://localhost:8000  # For RAG
GITHUB_TOKEN=your_token  # For GitHub MCP
PORT=3000
LOG_LEVEL=info
```

## Installation

1. Install dependencies:
```bash
cd AI_Agent_LG/adapters
npm install
```

2. (Optional) Start ChromaDB for RAG:
```bash
docker run -p 8000:8000 chromadb/chroma
```

3. Set environment variables in `.env`

4. Start the server:
```bash
npm run dev:langgraph
```

## Architecture

```
adapters/
├── core/
│   ├── memory.js          # Persistent memory
│   ├── rag.js             # RAG with vector embeddings
│   ├── callbacks.js       # Tracking and logging
│   ├── multiAgent.js      # Multi-agent team
│   ├── financial.js       # Financial tools
│   ├── research.js        # Research tools
│   ├── meeting.js         # Meeting tools
│   ├── travel.js          # Travel tools
│   ├── social.js          # Social media tools
│   ├── health.js          # Health tracking
│   ├── mcp.js             # MCP integrations
│   ├── tools.js           # Core tools
│   ├── instructions.js    # System instructions
│   └── storage.js         # Data storage
└── server_langgraph.js    # Main server
```

## Future Enhancements

- Voice interface integration
- Advanced web scraping with Puppeteer
- Real API integrations (LinkedIn, Twitter, flight/hotel APIs)
- Notion API integration
- Enhanced evaluation metrics
- Advanced error recovery

## Notes

- Many features include placeholder implementations that require API keys or external services
- RAG gracefully degrades if ChromaDB is not available
- Memory is stored in `data/memory/` directory
- All features are integrated into the main LangGraph workflow

