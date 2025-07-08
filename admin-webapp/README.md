# Browser Use Admin Webapp

Central command center for managing multiple Browser Use worker agents. This webapp provides real-time task orchestration, worker management, and credential storage for distributed browser automation.

## Features

- 🔗 **Real-time Worker Management** - Connect and monitor multiple worker clients
- 📋 **Task Distribution** - Send natural language tasks to specific workers or broadcast to all
- 🔐 **Credential Store** - Centralized username/password management for automation tasks
- 📊 **Live Monitoring** - Real-time execution logs from Browser Use agents
- 🔄 **Auto-reconnection** - Handles worker disconnections gracefully
- 🔒 **Token-based Security** - 6-digit auto-generated worker registration tokens

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Open admin interface:**
   - Go to `http://localhost:3000`
   - Note the current worker token (6-digit code)

4. **Connect workers:**
   - Start worker clients with `npm start` in worker-client directory
   - Enter the token when prompted

## Usage Guide

### Worker Registration
- New 6-digit tokens auto-generate every 10 minutes
- Workers connect using: `ws://localhost:3000`
- Token is displayed prominently in the admin interface

### Task Assignment
1. **Select target workers** (specific worker or "All Workers")
2. **Enter natural language task** in the text area:
   ```
   "Fill out the contact form on example.com"
   "Extract product prices from this e-commerce site"
   "Login to Gmail and mark emails as read"
   ```
3. **Click Send Task** - workers will execute immediately

### Credential Management
- Add credentials in natural language format:
  ```
  Google Email: john.doe@gmail.com
  Google Password: mypassword123
  LinkedIn Username: john.doe@company.com
  LinkedIn Password: linkedinpass456
  ```
- Workers automatically access credentials when needed
- Passwords are masked in the interface for security

### Live Monitoring
- **Worker Status**: Connection state, current task, execution progress
- **Real-time Logs**: Live stream from Browser Use agents
- **Task Results**: Completion status and extracted information

## Browser Use Integration (Phase 2)

The admin webapp now supports **real Browser Use automation** instead of simulations:

### What's New
- ✅ **Real browser automation** using Browser Use Python library
- ✅ **Chromium browser** controlled by AI agents
- ✅ **OpenAI/DeepSeek API** integration for natural language processing
- ✅ **Credential injection** for login forms and authentication
- ✅ **Live browser execution** with visual feedback

### Worker Requirements
Workers now need:
- Python 3.8+ with Browser Use library installed
- OpenAI or DeepSeek API key
- Chromium browser (installed via Playwright)

### Task Examples
Try these real automation tasks:
```bash
# Simple navigation
"Go to google.com and search for 'Browser Use automation'"

# Form filling
"Fill out the contact form on example.com with my information"

# Data extraction
"Go to news.ycombinator.com and list the top 5 story titles"

# E-commerce automation
"Add a laptop to cart on amazon.com (don't complete purchase)"
```

## Configuration

### Environment Variables
```bash
# Server configuration
PORT=3000                    # Admin webapp port
NODE_ENV=development         # Environment mode

# Worker API keys (for centralized management)
OPENAI_API_KEY=sk-...       # OpenAI API key
DEEPSEEK_API_KEY=sk-...     # DeepSeek API key
```

### Data Storage
- `data/credentials.json` - Stored credentials
- `data/workers.json` - Worker registry and states
- `data/tasks.json` - Task history (future feature)

## WebSocket Protocol

### Message Types
```javascript
// Worker registration
REGISTER_WORKER: { workerId, capabilities, token }

// Task assignment
TASK_ASSIGNMENT: { taskId, task, credentials, targetWorker }

// Status updates
STATUS_UPDATE: { workerId, status, currentTask }

// Execution logs
EXECUTION_LOG: { workerId, timestamp, level, message }

// Task completion
TASK_COMPLETE: { taskId, result, success, duration }

// Heartbeat
HEARTBEAT: { workerId, timestamp }
```

## Development

### Local Development
```bash
# Start in development mode
npm run dev

# Run with debugging
DEBUG=* npm start

# Watch for file changes
npx nodemon server.js
```

### Testing Worker Connection
1. Start admin webapp: `npm start`
2. Start worker client: `cd worker-client && npm start`
3. Enter displayed token in worker
4. Send test task: "Go to google.com"

## Deployment

### Local/Development
- Run directly with `npm start`
- Access at `http://localhost:3000`

### Production (Railway/Render)
1. **Environment variables:**
   ```bash
   NODE_ENV=production
   PORT=3000
   ```

2. **Deploy static files to Vercel:**
   - Upload `public/` directory
   - Point WebSocket URL to your Railway/Render instance

3. **Deploy WebSocket server to Railway:**
   - Connect GitHub repository
   - Set environment variables
   - Deploy automatically

## Architecture

```
Admin Webapp
├── WebSocket Server (server.js)
├── Worker Manager (lib/workerManager.js)
├── Credential Store (lib/credentialStore.js)
├── Message Router (lib/messageRouter.js)
└── Web Interface (public/)
    ├── Real-time Dashboard
    ├── Task Management
    └── Worker Monitoring

Connected Workers
├── Browser Use Agent (Python)
├── Chromium Browser
└── WebSocket Client
```

## Troubleshooting

### Worker Connection Issues
- Check token hasn't expired (10-minute limit)
- Verify WebSocket server is running on port 3000
- Ensure firewall allows WebSocket connections

### Browser Use Issues
- Workers need proper Python setup (`npm run setup` in worker-client)
- API keys must be configured on worker machines
- Chromium browser must be installed via Playwright

### Performance Issues
- Limit concurrent workers (3-5 recommended for MVP)
- Monitor API usage costs (OpenAI/DeepSeek charges per request)
- Consider task timeouts for long-running automations

## Security Notes

- Tokens auto-rotate every 10 minutes
- Credentials stored in plain text (encrypt in production)
- WebSocket connections not encrypted (use WSS in production)
- No authentication on admin interface (add in production)

## License

MIT 