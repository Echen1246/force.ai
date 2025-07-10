-- Browser Use SaaS Platform Database Schema
-- Multi-tenant workspace-based architecture

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Workspaces (Customer organizations/accounts)
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL, -- URL-friendly: acme-corp
  plan VARCHAR(50) DEFAULT 'free', -- free, pro, team, enterprise
  max_workers INTEGER DEFAULT 2,
  billing_email VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  avatar_url VARCHAR(500),
  email_verified BOOLEAN DEFAULT false,
  email_verification_token VARCHAR(255),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User workspace memberships (many-to-many)
CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member', -- owner, admin, member, viewer
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

-- Worker connection codes (temporary invitation codes)
CREATE TABLE worker_connection_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  code VARCHAR(50) UNIQUE NOT NULL, -- WS-ABC123-XYZ
  name VARCHAR(255), -- Optional description
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workers (Customer's machines running Electron app)
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  connection_code_id UUID REFERENCES worker_connection_codes(id),
  device_info JSONB, -- hostname, platform, arch, app_version
  capabilities JSONB DEFAULT '[]', -- web-automation, form-filling, etc.
  ai_config JSONB, -- model preferences, encrypted API key reference
  status VARCHAR(50) DEFAULT 'offline', -- online, offline, busy, error
  last_seen TIMESTAMP,
  last_heartbeat TIMESTAMP,
  total_tasks_completed INTEGER DEFAULT 0,
  average_execution_time DECIMAL DEFAULT 0,
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
  priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
  worker_filter JSONB, -- Optional filters: tags, capabilities
  assigned_worker_id UUID REFERENCES workers(id),
  result TEXT,
  error_message TEXT,
  execution_time_seconds DECIMAL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  assigned_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Workspace credentials (encrypted with workspace key)
CREATE TABLE workspace_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  encrypted_value TEXT NOT NULL, -- AES-256 encrypted
  credential_type VARCHAR(100), -- username, password, api_key, etc.
  tags JSONB DEFAULT '[]',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Task execution logs
CREATE TABLE task_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id),
  level VARCHAR(20) NOT NULL, -- info, warning, error, debug
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Usage metrics (for billing and analytics)
CREATE TABLE usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_type VARCHAR(100) NOT NULL, -- tasks_completed, worker_hours, api_calls
  value INTEGER NOT NULL,
  metadata JSONB, -- Additional context like worker_id, endpoint, etc.
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- Billing subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  plan VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL, -- active, canceled, past_due, trialing
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- API tokens for programmatic access
CREATE TABLE api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  permissions JSONB DEFAULT '{}', -- scoped permissions
  expires_at TIMESTAMP,
  last_used_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook endpoints
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  events JSONB NOT NULL, -- ['task.completed', 'worker.offline']
  secret VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook delivery log
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  attempt_count INTEGER DEFAULT 1,
  delivered_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_workspaces_slug ON workspaces(slug);
CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX idx_workers_workspace ON workers(workspace_id);
CREATE INDEX idx_workers_status ON workers(status);
CREATE INDEX idx_workers_last_seen ON workers(last_seen);
CREATE INDEX idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assigned_worker ON tasks(assigned_worker_id);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_task_logs_task ON task_logs(task_id);
CREATE INDEX idx_task_logs_worker ON task_logs(worker_id);
CREATE INDEX idx_usage_metrics_workspace ON usage_metrics(workspace_id);
CREATE INDEX idx_usage_metrics_recorded_at ON usage_metrics(recorded_at);

-- Row Level Security (RLS) for multi-tenancy
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can only access data from their workspaces)
CREATE POLICY workspace_isolation ON workspaces
  USING (id IN (
    SELECT workspace_id FROM workspace_members 
    WHERE user_id = auth.uid()
  ));

CREATE POLICY workspace_member_isolation ON workspace_members
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members 
    WHERE user_id = auth.uid()
  ));

-- Create default plans
INSERT INTO public.plans (name, price, max_workers, max_tasks_per_month, features) VALUES
('free', 0, 2, 100, '["basic_dashboard", "email_support"]'),
('pro', 29, 10, 1000, '["advanced_dashboard", "task_scheduling", "priority_support", "webhooks"]'),
('team', 99, 50, 10000, '["team_collaboration", "custom_integrations", "phone_support", "sso"]'),
('enterprise', -1, -1, -1, '["on_premise_option", "sso", "dedicated_support", "custom_integrations"]');

-- Create plans table if it doesn't exist
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  price INTEGER NOT NULL, -- in cents, -1 for custom
  max_workers INTEGER NOT NULL, -- -1 for unlimited
  max_tasks_per_month INTEGER NOT NULL, -- -1 for unlimited
  features JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
); 