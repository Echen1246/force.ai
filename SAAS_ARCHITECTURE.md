# 🌐 Browser Use Orchestration Platform - SaaS Architecture

## 📋 Business Model Overview

**Customer Value Proposition:**
- Download Electron worker app on their machines (VMs, laptops, servers)
- Use their own OpenAI/Claude API keys (they control costs & data)
- Manage multiple workers through our centralized web dashboard
- Pay subscription for orchestration service, not compute/AI costs

**Revenue Model:**
- **Freemium**: 2 workers, basic features
- **Pro**: $29/month - 10 workers, advanced scheduling
- **Team**: $99/month - 50 workers, team collaboration
- **Enterprise**: Custom pricing - unlimited workers, on-premise option

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SaaS Platform (Your Infrastructure)         │
├─────────────────────────────────────────────────────────────────┤
│  Web Dashboard: app.browseruse.com (React/Next.js)             │
│  API Gateway: api.browseruse.com (Node.js/Express)             │
│  WebSocket Hub: ws.browseruse.com (Socket.io/ws)               │
│  Database: PostgreSQL (User accounts, workspaces, tasks)       │
│  Auth Service: JWT + OAuth (Google, Microsoft SSO)             │
└─────────────────────────────────────────────────────────────────┘
                                    ↕ WebSocket/HTTPS
┌─────────────────────────────────────────────────────────────────┐
│                  Customer Infrastructure                        │
├─────────────────────────────────────────────────────────────────┤
│  Worker 1: Laptop (Mac/Windows) - Customer's OpenAI API Key    │
│  Worker 2: AWS EC2 Instance - Customer's OpenAI API Key        │  
│  Worker 3: Office Computer - Customer's OpenAI API Key         │
│  Worker 4: Home Server - Customer's OpenAI API Key             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Authentication & Onboarding Flow

### **1. Customer Registration**

#### Web Signup:
```javascript
// Registration form at app.browseruse.com/signup
{
  "name": "John Doe",
  "email": "john@company.com", 
  "company": "Acme Corp",
  "password": "secure_password",
  "plan": "pro" // free, pro, team, enterprise
}
```

#### Account Creation Response:
```javascript
{
  "user_id": "uuid",
  "workspace_id": "uuid", 
  "workspace_name": "acme-corp",
  "auth_token": "jwt_token",
  "download_url": "https://releases.browseruse.com/worker-v1.2.3.dmg"
}
```

### **2. Worker Download & Setup**

#### Download Page:
```html
<!-- app.browseruse.com/download -->
<div class="download-section">
  <h2>Download Worker App</h2>
  <p>Install on Windows, Mac, or Linux machines</p>
  
  <div class="download-buttons">
    <a href="/downloads/worker-windows-x64.exe">Windows (x64)</a>
    <a href="/downloads/worker-macos-universal.dmg">macOS (Universal)</a>
    <a href="/downloads/worker-linux-x64.AppImage">Linux (x64)</a>
  </div>
  
  <div class="setup-instructions">
    <h3>Setup Instructions:</h3>
    <ol>
      <li>Download and install the worker app</li>
      <li>Copy your workspace connection code: <code id="connection-code">WS-ABC123-XYZ</code></li>
      <li>Enter your OpenAI API key in the worker app</li>
      <li>Paste the connection code to join your workspace</li>
    </ol>
  </div>
</div>
```

### **3. Worker Connection Flow**

#### Worker App First Launch:
```javascript
// Worker app startup screen
{
  screens: [
    {
      title: "Welcome to Browser Use Worker",
      subtitle: "Connect to your workspace",
      fields: [
        {
          label: "Workspace Connection Code",
          placeholder: "WS-ABC123-XYZ",
          required: true
        },
        {
          label: "Worker Name", 
          placeholder: "Marketing Team Laptop",
          default: "{{hostname}}"
        }
      ]
    },
    {
      title: "AI Configuration",
      subtitle: "Enter your API credentials",
      fields: [
        {
          label: "OpenAI API Key",
          type: "password",
          placeholder: "sk-...",
          required: true
        },
        {
          label: "Model",
          type: "select",
          options: ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
          default: "gpt-4o-mini"
        }
      ]
    }
  ]
}
```

#### Worker Registration API:
```javascript
// POST /api/workers/connect
{
  "connection_code": "WS-ABC123-XYZ",
  "worker_name": "Marketing Team Laptop",
  "device_info": {
    "hostname": "johns-macbook-pro",
    "platform": "darwin",
    "arch": "arm64",
    "app_version": "1.2.3"
  },
  "capabilities": ["web-automation", "form-filling", "data-extraction"]
}

// Response:
{
  "worker_id": "uuid",
  "workspace_id": "uuid", 
  "auth_token": "worker_jwt_token",
  "websocket_url": "wss://ws.browseruse.com/workers",
  "settings": {
    "max_concurrent_tasks": 1,
    "heartbeat_interval": 60000
  }
}
```

---

## 💾 Database Schema (Multi-tenant SaaS)

```sql
-- Workspaces (Customer organizations)
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL, -- acme-corp
  plan VARCHAR(50) DEFAULT 'free', -- free, pro, team, enterprise
  max_workers INTEGER DEFAULT 2,
  billing_email VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users (Can belong to multiple workspaces)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(500),
  email_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User workspace memberships
CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member', -- owner, admin, member, viewer
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

-- Worker connection codes (temporary)
CREATE TABLE worker_connection_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  code VARCHAR(50) UNIQUE NOT NULL, -- WS-ABC123-XYZ
  name VARCHAR(255), -- Optional name for the code
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workers (Customer's machines)
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  connection_code_id UUID REFERENCES worker_connection_codes(id),
  device_info JSONB,
  capabilities JSONB DEFAULT '[]',
  ai_config JSONB, -- Encrypted API keys, model preferences
  status VARCHAR(50) DEFAULT 'offline', -- online, offline, busy, error
  last_seen TIMESTAMP,
  total_tasks_completed INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tasks
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, assigned, running, completed, failed, cancelled
  priority VARCHAR(20) DEFAULT 'normal',
  assigned_worker_id UUID REFERENCES workers(id),
  result TEXT,
  error_message TEXT,
  execution_time_seconds DECIMAL,
  created_by UUID REFERENCES users(id),
  assigned_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Workspace credentials (encrypted)
CREATE TABLE workspace_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  encrypted_value TEXT NOT NULL, -- AES-256 encrypted
  credential_type VARCHAR(100),
  tags JSONB DEFAULT '[]',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Usage tracking (for billing)
CREATE TABLE usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_type VARCHAR(100) NOT NULL, -- tasks_completed, worker_hours, api_calls
  value INTEGER NOT NULL,
  metadata JSONB,
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- Billing subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255),
  plan VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL, -- active, canceled, past_due
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔧 Worker App Architecture

### **Electron App Structure:**
```
worker-app/
├── main.js              # Main Electron process
├── preload.js           # Bridge between main and renderer
├── renderer/
│   ├── setup.html       # Initial setup wizard
│   ├── dashboard.html   # Worker status dashboard
│   └── settings.html    # Configuration panel
├── lib/
│   ├── platformConnection.js  # Connect to SaaS platform
│   ├── browserUseManager.js   # Execute browser tasks
│   ├── apiKeyManager.js       # Secure API key storage
│   └── configManager.js       # Settings persistence
└── assets/
    ├── icon.png
    └── tray-icon.png
```

### **API Key Management (Secure):**
```javascript
// lib/apiKeyManager.js
const keytar = require('keytar');
const crypto = require('crypto');

class APIKeyManager {
  constructor() {
    this.serviceName = 'BrowserUseWorker';
  }

  async storeAPIKey(workspaceId, apiKey) {
    // Store in system keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
    await keytar.setPassword(
      this.serviceName, 
      `openai_key_${workspaceId}`, 
      apiKey
    );
  }

  async getAPIKey(workspaceId) {
    return await keytar.getPassword(
      this.serviceName, 
      `openai_key_${workspaceId}`
    );
  }

  async deleteAPIKey(workspaceId) {
    return await keytar.deletePassword(
      this.serviceName, 
      `openai_key_${workspaceId}`
    );
  }
}
```

### **Platform Connection:**
```javascript
// lib/platformConnection.js
class PlatformConnection extends EventEmitter {
  constructor() {
    super();
    this.platformUrl = 'wss://ws.browseruse.com';
    this.ws = null;
    this.authToken = null;
    this.workspaceId = null;
  }

  async connect(connectionCode, workerName, deviceInfo) {
    // Step 1: Exchange connection code for auth token
    const response = await fetch('https://api.browseruse.com/workers/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_code: connectionCode,
        worker_name: workerName,
        device_info: deviceInfo
      })
    });

    const { worker_id, workspace_id, auth_token, websocket_url } = await response.json();
    
    this.workerId = worker_id;
    this.workspaceId = workspace_id;
    this.authToken = auth_token;

    // Step 2: Connect to WebSocket with auth token
    this.ws = new WebSocket(`${websocket_url}?token=${auth_token}`);
    
    this.ws.on('message', (data) => {
      const message = JSON.parse(data);
      this.handleMessage(message);
    });

    // Step 3: Save connection info for auto-reconnect
    await this.saveConnectionInfo();
  }

  async executeTask(task) {
    // Get customer's API key from secure storage
    const apiKey = await this.apiKeyManager.getAPIKey(this.workspaceId);
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Execute task using customer's API key
    const result = await this.browserUseManager.executeTask(task, {
      openai_api_key: apiKey,
      model: this.getPreferredModel()
    });

    return result;
  }
}
```

---

## 🌐 SaaS Platform APIs

### **Authentication Endpoints:**
```javascript
// Auth routes
POST /auth/register     # User registration
POST /auth/login        # User login  
POST /auth/logout       # Logout
POST /auth/refresh      # Refresh JWT token
POST /auth/verify-email # Email verification

// OAuth routes
GET  /auth/google       # Google OAuth
GET  /auth/microsoft    # Microsoft OAuth
```

### **Workspace Management:**
```javascript
// Workspace routes
GET  /workspaces                    # List user's workspaces
POST /workspaces                    # Create new workspace
GET  /workspaces/:id                # Get workspace details
PUT  /workspaces/:id                # Update workspace
DELETE /workspaces/:id              # Delete workspace

// Member management
GET  /workspaces/:id/members        # List members
POST /workspaces/:id/invite         # Invite user to workspace
PUT  /workspaces/:id/members/:userId # Update member role
DELETE /workspaces/:id/members/:userId # Remove member
```

### **Worker Management:**
```javascript
// Worker connection
POST /workers/connection-codes      # Generate worker connection code
POST /workers/connect              # Connect worker to workspace
PUT  /workers/:id/status           # Update worker status
DELETE /workers/:id                # Remove worker

// Admin routes
GET  /workspaces/:id/workers       # List workspace workers
GET  /workspaces/:id/workers/:workerId # Get worker details
```

### **Task Management:**
```javascript
// Task routes
GET  /workspaces/:id/tasks         # List workspace tasks
POST /workspaces/:id/tasks         # Create new task
GET  /tasks/:id                    # Get task details
PUT  /tasks/:id/cancel             # Cancel task
DELETE /tasks/:id                  # Delete task

// Worker routes (internal)
POST /workers/tasks/:id/start      # Worker starts task
POST /workers/tasks/:id/complete   # Worker completes task
POST /workers/tasks/:id/log        # Worker sends log
```

---

## 💳 Billing & Subscription Management

### **Stripe Integration:**
```javascript
// Subscription tiers
const PLANS = {
  free: {
    price: 0,
    max_workers: 2,
    max_tasks_per_month: 100,
    features: ['basic_dashboard', 'email_support']
  },
  pro: {
    price: 29,
    max_workers: 10,
    max_tasks_per_month: 1000,
    features: ['advanced_dashboard', 'task_scheduling', 'priority_support']
  },
  team: {
    price: 99,
    max_workers: 50,
    max_tasks_per_month: 10000,
    features: ['team_collaboration', 'custom_integrations', 'phone_support']
  },
  enterprise: {
    price: 'custom',
    max_workers: 'unlimited',
    max_tasks_per_month: 'unlimited',
    features: ['on_premise_option', 'sso', 'dedicated_support']
  }
};
```

### **Usage Tracking:**
```javascript
// Track usage for billing
async function trackUsage(workspaceId, metricType, value, metadata = {}) {
  await db.query(
    'INSERT INTO usage_metrics (workspace_id, metric_type, value, metadata) VALUES ($1, $2, $3, $4)',
    [workspaceId, metricType, value, metadata]
  );
}

// Examples:
trackUsage(workspaceId, 'task_completed', 1, { worker_id, execution_time });
trackUsage(workspaceId, 'worker_connected', 1, { worker_id });
trackUsage(workspaceId, 'api_calls', 5, { endpoint: '/tasks' });
```

---

## 📱 Customer Experience Flow

### **Day 1: Onboarding**
1. **Signup**: Customer creates account at `app.browseruse.com`
2. **Workspace**: Auto-created workspace (e.g., "acme-corp")
3. **Download**: Download worker app for their OS
4. **Setup**: Enter connection code + OpenAI API key
5. **First Task**: Send test task from web dashboard

### **Day 2-30: Growth**
1. **Scale Up**: Install workers on more machines
2. **Collaborate**: Invite team members to workspace
3. **Automate**: Set up recurring tasks and schedules
4. **Integrate**: Use webhooks to connect with their tools

### **Month 2+: Advanced Usage**
1. **Upgrade**: Move to Pro/Team plan for more workers
2. **Optimize**: Fine-tune worker configurations
3. **Monitor**: Track performance and costs
4. **Expand**: Deploy workers across different environments

---

## 🚀 Go-to-Market Strategy

### **Pricing Strategy:**
- **Free tier**: Get customers started with 2 workers
- **Pro tier**: Individual power users and small teams
- **Team tier**: Growing companies with multiple departments
- **Enterprise**: Large organizations with compliance needs

### **Customer Acquisition:**
- **Content Marketing**: Automation tutorials, use cases
- **Developer Community**: Open source components, GitHub presence
- **Partner Channel**: Integration with no-code tools (Zapier, Make)
- **Direct Sales**: Enterprise accounts

### **Revenue Projections:**
- **Year 1**: 1,000 free users, 100 paid users → $50K ARR
- **Year 2**: 5,000 free users, 500 paid users → $300K ARR  
- **Year 3**: 20,000 free users, 2,000 paid users → $1.2M ARR

This SaaS model is excellent because:
- **Low Infrastructure Costs**: Customers provide compute
- **Scalable**: Easy to add more customers
- **Sticky**: Workers become part of customer workflow
- **Defensible**: Network effects and data lock-in

Would you like me to start building the first component (user registration, worker connection system, etc.)? 