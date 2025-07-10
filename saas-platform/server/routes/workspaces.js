const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../database/connection');
const { checkWorkspaceAccess, requireWorkspaceAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');
const router = express.Router();

// GET /workspaces - List user's workspaces
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;

    const workspacesResult = await pool.query(
      `SELECT w.id, w.name, w.slug, w.plan, w.max_workers, wm.role, w.created_at,
              (SELECT COUNT(*) FROM workers WHERE workspace_id = w.id) as worker_count,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id) as total_tasks
       FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1
       ORDER BY w.created_at DESC`,
      [userId]
    );

    res.json({
      workspaces: workspacesResult.rows
    });

  } catch (error) {
    logger.error('Get workspaces error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to get workspaces'
    });
  }
});

// GET /workspaces/:id - Get workspace details
router.get('/:id', checkWorkspaceAccess, async (req, res) => {
  try {
    const workspaceId = req.params.id;

    // Get workspace details with stats
    const workspaceResult = await pool.query(
      `SELECT w.*, 
              (SELECT COUNT(*) FROM workers WHERE workspace_id = w.id) as worker_count,
              (SELECT COUNT(*) FROM workers WHERE workspace_id = w.id AND status = 'online') as online_workers,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id) as total_tasks,
              (SELECT COUNT(*) FROM tasks WHERE workspace_id = w.id AND status = 'completed') as completed_tasks
       FROM workspaces w
       WHERE w.id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Workspace not found'
      });
    }

    const workspace = workspaceResult.rows[0];

    // Get workspace members
    const membersResult = await pool.query(
      `SELECT u.id, u.name, u.email, wm.role, wm.joined_at
       FROM workspace_members wm
       JOIN users u ON wm.user_id = u.id
       WHERE wm.workspace_id = $1
       ORDER BY wm.joined_at ASC`,
      [workspaceId]
    );

    res.json({
      workspace: {
        ...workspace,
        members: membersResult.rows
      }
    });

  } catch (error) {
    logger.error('Get workspace details error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to get workspace details'
    });
  }
});

// GET /workspaces/:id/workers - Get workspace workers
router.get('/:id/workers', checkWorkspaceAccess, async (req, res) => {
  try {
    const workspaceId = req.params.id;

    const workersResult = await pool.query(
      `SELECT id, name, status, device_info, capabilities, last_seen, 
              total_tasks_completed, average_execution_time, created_at
       FROM workers 
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId]
    );

    res.json({
      workers: workersResult.rows
    });

  } catch (error) {
    logger.error('Get workspace workers error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to get workspace workers'
    });
  }
});

module.exports = router; 