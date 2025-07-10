const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { pool } = require('../database/connection');
const { authenticateToken, authenticateWorker } = require('../middleware/auth');
const logger = require('../utils/logger');
const router = express.Router();

// Generate worker connection code
function generateConnectionCode() {
  const prefix = 'WS';
  const part1 = crypto.randomBytes(3).toString('hex').toUpperCase();
  const part2 = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${part1}-${part2}`;
}

// Generate worker JWT token
function generateWorkerToken(workerId, workspaceId) {
  return jwt.sign(
    { workerId, workspaceId, type: 'worker' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' } // Workers have longer-lived tokens
  );
}

// POST /workers/connection-codes - Generate connection code for workspace
router.post('/connection-codes', authenticateToken, [
  body('name').optional().trim().isLength({ min: 1, max: 255 }),
  body('max_uses').optional().isInt({ min: 1, max: 100 }).toInt(),
  body('expires_in_hours').optional().isInt({ min: 1, max: 168 }).toInt() // Max 1 week
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { name, max_uses = 1, expires_in_hours = 24 } = req.body;
    const userId = req.user.userId;

    // Get user's workspace (assuming user has access to first workspace)
    const workspaceResult = await pool.query(
      'SELECT w.id, w.name FROM workspaces w JOIN workspace_members wm ON w.id = wm.workspace_id WHERE wm.user_id = $1 LIMIT 1',
      [userId]
    );

    if (workspaceResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No Workspace',
        message: 'No workspace found for user'
      });
    }

    const workspace = workspaceResult.rows[0];

    // Check workspace worker limit
    const workerCount = await pool.query(
      'SELECT COUNT(*) as count FROM workers WHERE workspace_id = $1',
      [workspace.id]
    );

    const maxWorkers = await pool.query(
      'SELECT max_workers FROM workspaces WHERE id = $1',
      [workspace.id]
    );

    if (parseInt(workerCount.rows[0].count) >= parseInt(maxWorkers.rows[0].max_workers)) {
      return res.status(400).json({
        error: 'Worker Limit Reached',
        message: `Maximum of ${maxWorkers.rows[0].max_workers} workers allowed for your plan`
      });
    }

    // Generate unique connection code
    let connectionCode;
    let isUnique = false;
    
    while (!isUnique) {
      connectionCode = generateConnectionCode();
      const existing = await pool.query(
        'SELECT id FROM worker_connection_codes WHERE code = $1',
        [connectionCode]
      );
      isUnique = existing.rows.length === 0;
    }

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000);

    // Save connection code
    const codeResult = await pool.query(
      `INSERT INTO worker_connection_codes 
       (workspace_id, code, name, max_uses, expires_at, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, code, name, max_uses, expires_at`,
      [workspace.id, connectionCode, name, max_uses, expiresAt, userId]
    );

    const code = codeResult.rows[0];

    logger.info(`Connection code generated: ${connectionCode} for workspace: ${workspace.name}`);

    res.status(201).json({
      message: 'Connection code generated successfully',
      connection_code: {
        id: code.id,
        code: code.code,
        name: code.name,
        max_uses: code.max_uses,
        used_count: 0,
        expires_at: code.expires_at,
        workspace: {
          id: workspace.id,
          name: workspace.name
        }
      }
    });

  } catch (error) {
    logger.error('Connection code generation error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to generate connection code'
    });
  }
});

// POST /workers/connect - Worker connects using connection code
router.post('/connect', [
  body('connection_code').trim().notEmpty(),
  body('worker_name').trim().isLength({ min: 1, max: 255 }),
  body('device_info').isObject(),
  body('capabilities').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { connection_code, worker_name, device_info, capabilities = [] } = req.body;

    // Validate connection code
    const codeResult = await pool.query(
      `SELECT wcc.*, w.name as workspace_name 
       FROM worker_connection_codes wcc
       JOIN workspaces w ON wcc.workspace_id = w.id
       WHERE wcc.code = $1 AND wcc.expires_at > NOW()`,
      [connection_code]
    );

    if (codeResult.rows.length === 0) {
      return res.status(400).json({
        error: 'Invalid Connection Code',
        message: 'Connection code is invalid or expired'
      });
    }

    const connectionCodeData = codeResult.rows[0];

    // Check if connection code is still usable
    if (connectionCodeData.used_count >= connectionCodeData.max_uses) {
      return res.status(400).json({
        error: 'Connection Code Exhausted',
        message: 'This connection code has reached its usage limit'
      });
    }

    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create worker
      const workerResult = await client.query(
        `INSERT INTO workers 
         (workspace_id, name, connection_code_id, device_info, capabilities, status, last_seen) 
         VALUES ($1, $2, $3, $4, $5, 'offline', NOW()) 
         RETURNING id, workspace_id, name, device_info, capabilities, status, created_at`,
        [connectionCodeData.workspace_id, worker_name, connectionCodeData.id, device_info, capabilities]
      );

      const worker = workerResult.rows[0];

      // Update connection code usage
      await client.query(
        'UPDATE worker_connection_codes SET used_count = used_count + 1 WHERE id = $1',
        [connectionCodeData.id]
      );

      await client.query('COMMIT');

      // Generate worker auth token
      const authToken = generateWorkerToken(worker.id, worker.workspace_id);

      logger.info(`Worker connected: ${worker_name} to workspace: ${connectionCodeData.workspace_name}`);

      res.status(201).json({
        message: 'Worker connected successfully',
        worker: {
          id: worker.id,
          name: worker.name,
          workspace_id: worker.workspace_id,
          device_info: worker.device_info,
          capabilities: worker.capabilities,
          status: worker.status
        },
        workspace: {
          id: connectionCodeData.workspace_id,
          name: connectionCodeData.workspace_name
        },
        auth_token: authToken,
        websocket_url: `${process.env.WEBSOCKET_URL || 'ws://localhost:3001'}/workers`,
        settings: {
          heartbeat_interval: 60000,
          max_concurrent_tasks: 1
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error('Worker connection error:', error);
    res.status(500).json({
      error: 'Connection Failed',
      message: 'Failed to connect worker. Please try again.'
    });
  }
});

// PUT /workers/:id/status - Update worker status
router.put('/:id/status', authenticateWorker, [
  body('status').isIn(['online', 'offline', 'busy', 'error']),
  body('metadata').optional().isObject()
], async (req, res) => {
  try {
    const { status, metadata = {} } = req.body;
    const workerId = req.params.id;

    // Verify worker owns this ID
    if (req.worker.workerId !== workerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Cannot update status for different worker'
      });
    }

    // Update worker status
    await pool.query(
      'UPDATE workers SET status = $1, last_seen = NOW(), last_heartbeat = NOW() WHERE id = $2',
      [status, workerId]
    );

    res.json({
      message: 'Status updated successfully',
      status: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Worker status update error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to update worker status'
    });
  }
});

// POST /workers/:id/heartbeat - Worker heartbeat
router.post('/:id/heartbeat', authenticateWorker, async (req, res) => {
  try {
    const workerId = req.params.id;

    // Verify worker owns this ID
    if (req.worker.workerId !== workerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Cannot send heartbeat for different worker'
      });
    }

    // Update last seen and heartbeat
    await pool.query(
      'UPDATE workers SET last_seen = NOW(), last_heartbeat = NOW() WHERE id = $1',
      [workerId]
    );

    // Check for pending tasks
    const pendingTasks = await pool.query(
      `SELECT id, title, description, priority, created_at 
       FROM tasks 
       WHERE workspace_id = $1 AND status = 'pending' 
       ORDER BY priority DESC, created_at ASC 
       LIMIT 5`,
      [req.worker.workspaceId]
    );

    res.json({
      message: 'Heartbeat received',
      timestamp: new Date().toISOString(),
      pending_tasks: pendingTasks.rows
    });

  } catch (error) {
    logger.error('Worker heartbeat error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to process heartbeat'
    });
  }
});

// GET /workers/:id/tasks - Get assigned tasks for worker
router.get('/:id/tasks', authenticateWorker, async (req, res) => {
  try {
    const workerId = req.params.id;

    if (req.worker.workerId !== workerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Cannot access tasks for different worker'
      });
    }

    // Get assigned tasks
    const tasksResult = await pool.query(
      `SELECT id, title, description, status, priority, assigned_at, created_at
       FROM tasks 
       WHERE assigned_worker_id = $1 AND status IN ('assigned', 'running')
       ORDER BY priority DESC, assigned_at ASC`,
      [workerId]
    );

    res.json({
      tasks: tasksResult.rows
    });

  } catch (error) {
    logger.error('Get worker tasks error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to get worker tasks'
    });
  }
});

// DELETE /workers/:id - Remove worker (self-removal)
router.delete('/:id', authenticateWorker, async (req, res) => {
  try {
    const workerId = req.params.id;

    if (req.worker.workerId !== workerId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Cannot remove different worker'
      });
    }

    // Cancel any running tasks
    await pool.query(
      `UPDATE tasks SET status = 'cancelled', error_message = 'Worker disconnected' 
       WHERE assigned_worker_id = $1 AND status IN ('assigned', 'running')`,
      [workerId]
    );

    // Remove worker
    await pool.query('DELETE FROM workers WHERE id = $1', [workerId]);

    logger.info(`Worker removed: ${workerId}`);

    res.json({
      message: 'Worker removed successfully'
    });

  } catch (error) {
    logger.error('Worker removal error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to remove worker'
    });
  }
});

module.exports = router; 