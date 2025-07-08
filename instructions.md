# Browser Use Orchestration Platform - Cursor Prompts

## Part 1: Admin Webapp (Node.js + WebSocket Server)

### Project Overview
Create a Node.js web application that serves as the central control panel for managing multiple Browser Use worker agents. This is the "command center" that coordinates tasks across distributed workers.

### Core Requirements
1. **WebSocket Server**: Handle real-time bidirectional communication with multiple worker clients
2. **Worker Management**: Track connected workers, their status, and assign unique IDs
3. **Task Distribution**: Send natural language tasks to specific workers or broadcast to all
4. **Credential Management**: Centralized store for usernames/passwords in natural language format
5. **Real-time Monitoring**: Display live execution logs from Browser Use agents
6. **Simple Web UI**: Clean interface for task management and worker oversight

### Technical Stack
- **Backend**: Node.js with Express
- **WebSocket**: ws library for real-time communication
- **Frontend**: Simple HTML/CSS/JavaScript (no React needed for MVP)
- **Database**: JSON file storage for credentials and worker states (no database needed initially)
- **Deployment**: Vercel-compatible structure

### Key Features to Implement

#### WebSocket Server Architecture
- Accept connections from worker clients
- Implement worker registration with manual Admin ID pairing
- Handle worker disconnections gracefully
- Route messages between admin interface and specific workers
- Broadcast capabilities for sending tasks to all workers

#### Admin Interface Features
- **Dashboard**: List of connected workers with status indicators
- **Task Input**: Text area for natural language task input
- **Worker Selection**: Choose specific workers or "All Workers"
- **Credential Store**: Add/edit/view stored credentials in natural language format
- **Live Logs**: Real-time stream of worker execution logs
- **Worker Controls**: Start/stop/restart individual workers

#### Credential Management
- Store credentials in simple natural language format:
  ```
  Google username: john.doe@gmail.com
  Google password: mypassword123
  LinkedIn username: john.doe@company.com
  LinkedIn password: linkedinpass456
  ```
- Provide read-only access to workers
- Simple CRUD interface for managing credentials

#### Message Protocol
Define clear message types between admin and workers:
- `REGISTER_WORKER`: Worker registration with capabilities
- `TASK_ASSIGNMENT`: Send task to specific worker
- `STATUS_UPDATE`: Worker reports current status
- `EXECUTION_LOG`: Stream Browser Use execution details
- `CREDENTIAL_REQUEST`: Worker requests specific credentials
- `TASK_COMPLETE`: Worker reports task completion

### File Structure
```
admin-webapp/
├── server.js              # Main Express + WebSocket server
├── public/
│   ├── index.html         # Admin dashboard
│   ├── style.css          # UI styling
│   └── script.js          # Frontend WebSocket client
├── lib/
│   ├── workerManager.js   # Worker connection management
│   ├── credentialStore.js # Credential storage/retrieval
│   └── messageRouter.js   # WebSocket message routing
├── data/
│   ├── credentials.json   # Stored credentials
│   └── workers.json       # Worker registry
├── package.json
└── vercel.json           # Vercel deployment config
```

### Implementation Notes
- Keep the UI simple and functional - terminal-like interface is fine
- Focus on reliability over fancy features
- Ensure WebSocket connections are stable and can reconnect
- Log all activities for debugging
- Make the credential store easily editable
- Design for 3 worker connections initially (MVP limitation)

---

## Part 2: Worker Client (Electron App)

### Project Overview
Create an Electron application that runs on worker machines. This app provides a minimal overlay interface while running Browser Use agents in the background and communicating with the admin webapp.

### Core Requirements
1. **Minimal Overlay**: Cluely-inspired status bar showing agent activity
2. **Browser Use Integration**: Spawn and manage Browser Use Python subprocess
3. **WebSocket Client**: Maintain connection to admin webapp
4. **Credential Access**: Retrieve credentials from admin's centralized store
5. **Task Execution**: Receive tasks and pass them to Browser Use agent
6. **Status Reporting**: Stream execution logs back to admin

### Technical Stack
- **Framework**: Electron (for cross-platform desktop app)
- **Backend**: Node.js integration with Python subprocess
- **Browser Use**: Python subprocess running Browser Use library
- **WebSocket**: ws library for admin communication
- **UI**: Minimal HTML overlay (just status bar)

### Key Features to Implement

#### Electron App Structure
- **Main Process**: Handle window management, system tray, Python subprocess
- **Renderer Process**: Minimal overlay UI showing status
- **Always-on-top**: Overlay should stay visible but not interfere with work
- **System Integration**: Access to run Browser Use with proper permissions

#### Browser Use Integration
- Install Browser Use via pip in bundled Python environment
- Spawn Browser Use agent as subprocess
- Pass tasks from admin to Browser Use agent
- Capture Browser Use execution logs and stream to admin
- Handle Browser Use errors and restarts

#### WebSocket Client Features
- **Auto-connect**: Attempt connection to admin webapp on startup
- **Registration**: Register with admin using manual Admin ID input
- **Task Reception**: Receive task assignments from admin
- **Status Updates**: Send regular heartbeat and status updates
- **Log Streaming**: Forward Browser Use execution logs to admin
- **Credential Requests**: Request specific credentials when needed

#### Overlay Interface
- **Minimal Design**: Small bar at top of screen (similar to Cluely)
- **Status Indicator**: Show connection status, current task, activity
- **System Tray**: Option to minimize to system tray
- **Configuration**: Admin ID input, connection settings
- **Logs**: Local log viewer (optional)

### Browser Use Task Execution Flow
1. Receive task from admin via WebSocket
2. Retrieve necessary credentials from admin's credential store
3. Inject credentials into Browser Use agent context
4. Execute task using Browser Use agent
5. Stream execution logs back to admin in real-time
6. Report task completion or errors
7. Wait for next task

### File Structure
```
worker-client/
├── main.js                 # Main Electron process
├── preload.js             # Preload script for renderer
├── renderer/
│   ├── index.html         # Overlay interface
│   ├── style.css          # Overlay styling
│   └── renderer.js        # Renderer process logic
├── lib/
│   ├── browserUseManager.js # Browser Use subprocess management
│   ├── adminConnection.js   # WebSocket connection to admin
│   └── credentialClient.js  # Credential retrieval from admin
├── python/
│   ├── browser_use_agent.py # Browser Use execution wrapper
│   └── requirements.txt     # Python dependencies
├── package.json
└── electron-builder.json   # Electron packaging config
```

### Implementation Notes
- **Python Integration**: Use child_process to spawn Browser Use Python scripts
- **Error Handling**: Robust error handling for Browser Use failures
- **Reconnection**: Auto-reconnect to admin if connection drops
- **Security**: Validate admin ID before connecting
- **Performance**: Minimize resource usage when idle
- **Cross-platform**: Ensure compatibility across Windows/Mac/Linux
- **Packaging**: Create distributable installers for easy deployment

### Browser Use Python Wrapper
Create a Python script that:
- Accepts tasks via command line or stdin
- Initializes Browser Use agent with credentials
- Executes tasks and outputs structured logs
- Handles errors gracefully
- Provides status updates during execution

### Credential Injection System
- Request credentials from admin when Browser Use needs them
- Cache credentials locally for session (not persistent)
- Provide credentials to Browser Use in expected format
- Handle credential updates from admin

---

## Development Approach

### Phase 1: Basic Communication
1. Build WebSocket server and simple admin interface
2. Create basic Electron app with WebSocket client
3. Establish bidirectional communication
4. Implement worker registration system

### Phase 2: Browser Use Integration
1. Integrate Browser Use into worker client
2. Create task execution pipeline
3. Implement credential injection
4. Test with simple tasks (form filling)

### Phase 3: Management Features
1. Add credential management to admin interface
2. Implement task distribution and monitoring
3. Add error handling and recovery
4. Create proper logging and debugging tools

### Phase 4: Polish and Deployment
1. Create installer packages for worker client
2. Deploy admin webapp to Vercel
3. Add documentation and setup instructions
4. Test with multiple workers simultaneously

This architecture provides a solid foundation for your Browser Use orchestration platform while keeping the scope manageable for an MVP.

Answering questions:
You're downloading and installing Browser Use locally - not using an API!
Here's what's happening:

pip install browser-use downloads the Python library to your machine
playwright install chromium downloads the Chrome browser locally
Browser Use runs on your worker machines as a local Python process
Browser Use then makes API calls to OpenAI/Anthropic/etc. for the LLM reasoning

So your architecture is:

Worker machines: Run Browser Use Python library locally
Browser Use: Makes API calls to OpenAI (you pay OpenAI directly)
Your orchestration layer: Manages multiple Browser Use instances

Cost structure:

Browser Use library: Free (open source)
Playwright/Chromium: Free (open source)
LLM API calls: You pay OpenAI/Anthropic directly (~$0.01-0.03 per task)

For your worker client:

Bundle Python + Browser Use in the Electron app
Each worker runs its own Browser Use instance
You control them via your orchestration layer
Each worker makes its own API calls to OpenAI

This is actually perfect for your use case because:

No dependency on Browser Use's servers
Complete control over the agents
Can run offline except for LLM API calls
Scales horizontally (more workers = more parallel execution)

Your Electron app would:

Install Python + Browser Use locally
Spawn Browser Use agents as subprocesses
Pass tasks to those agents
Stream results back to your admin interface

Much better than relying on external APIs!RetryClaude can make mistakes. Please double-check responses.

2. Task Format: Based on the GitHub examples, it's plain English:

"Add grocery items to cart, and checkout"
"Add my latest LinkedIn follower to my leads in Salesforce"
"Write a letter in Google Docs and save as PDF"

Technical Architecture Answers
3. Admin ID Pairing: I recommend a simple token system:

Admin generates a 6-digit code (like "ABC123")
Worker enters this code to connect
Code expires after 10 minutes
Prevents unauthorized connections

4. WebSocket Connection: Single admin for MVP:

One admin webapp instance
Multiple workers connect to that admin
Keeps architecture simple
Can add multi-admin later

5. Credential Security: Plain text JSON for MVP:

Simple {"google_username": "john@gmail.com"} format
Shared across all workers initially
Worker-specific credentials can be added later
Basic encryption can be added post-MVP

Deployment & Environment
6. Worker Machine Requirements:

Cross-platform: Windows, Mac, Linux
Browser: Chrome/Chromium (Browser Use installs via Playwright)
Permissions: Standard user permissions (no admin needed)

7. Admin Webapp Hosting: Vercel with serverless limitations:

Use Vercel for static hosting
WebSocket connections through external service (like Railway/Render)
Or start with local development, deploy WebSocket server separately

Scope & Features
8. Browser Types: Chrome only for MVP:

Browser Use defaults to Chromium
Keeps testing simple
Other browsers can be added later

9. Task Complexity: Start simple, scale up:

MVP: Form filling, basic navigation
Later: Multi-step workflows, complex interactions

10. Error Recovery: Basic reporting for MVP:

Report errors back to admin
Admin decides whether to retry
Auto-retry can be added later

Recommended MVP Scope:

Single admin, 3 workers max
Chrome browser only
Plain text credentials
Basic error reporting
Simple task format: "Fill out job application on this website"

This keeps complexity manageable while proving the core concept works!

Final two questions:
1. WebSocket Hosting Strategy
Go with option 2: Structure for easy Railway/Render deployment
Reasoning:

Local development is fine for testing, but you'll want to demo this to potential investors/customers
Railway/Render have generous free tiers for small-scale WebSocket servers
Building with deployment in mind from the start saves refactoring later
You can still develop locally, but the code will be production-ready

Recommended approach:

Use environment variables for WebSocket server URL
WEBSOCKET_URL=ws://localhost:3001 for local dev
WEBSOCKET_URL=wss://your-app.railway.app for production
Deploy static frontend to Vercel, WebSocket server to Railway

2. Admin Token Generation
Auto-generate tokens when admin starts up
Reasoning:

Simpler UX - no extra steps for admin
More secure - tokens are temporary and rotate automatically
Better for demos - just start the server and show the token
Fits the "startup MVP" mentality - remove friction

Recommended flow:

Admin webapp starts up
Generates random 6-digit token (like "ABC123")
Displays token prominently on dashboard
Token expires after 10 minutes, auto-generates new one
Workers enter current token to connect

UI could show:
Current Worker Token: ABC123
(Expires in 8 minutes)
This keeps it simple for MVP while being secure enough. You can always add manual token creation later if needed.
TL;DR: Build for Railway deployment + auto-generated tokens = fastest path to a working demo!

We will test for local deployment first, and setup the Railway project later on when you want.