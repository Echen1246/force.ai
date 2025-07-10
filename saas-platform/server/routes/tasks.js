const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../database/connection');
const { checkWorkspaceAccess } = require('../middleware/auth');
const logger = require('../utils/logger');
const router = express.Router();

// GET /tasks/:workspaceId - List tasks for workspace
router.get('/:workspaceId', checkWorkspaceAccess, async (req, res) => {
  try {
    const workspaceId = req.params.workspaceId;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT t.*, 
             w.name as assigned_worker_name,
             u.name as created_by_name
      FROM tasks t
      LEFT JOIN workers w ON t.assigned_worker_id = w.id
      LEFT JOIN users u ON t.created_by = u.id
      WHERE t.workspace_id = $1
    `;
    
    const params = [workspaceId];

    if (status) {
      query += ` AND t.status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const tasksResult = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM tasks WHERE workspace_id = $1';
    const countParams = [workspaceId];
    
    if (status) {
      countQuery += ' AND status = $2';
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      tasks: tasksResult.rows,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < parseInt(countResult.rows[0].count)
      }
    });

  } catch (error) {
    logger.error('Get tasks error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to get tasks'
    });
  }
});

// POST /tasks/:workspaceId - Create new task
router.post('/:workspaceId', checkWorkspaceAccess, [
  body('title').trim().isLength({ min: 1, max: 500 }),
  body('description').trim().isLength({ min: 1 }),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
  body('worker_filter').optional().isObject(),
  body('max_retries').optional().isInt({ min: 0, max: 5 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const workspaceId = req.params.workspaceId;
    const { title, description, priority = 'normal', worker_filter = {}, max_retries = 0 } = req.body;
    const userId = req.user.userId;

    // Create task
    const taskResult = await pool.query(
      `INSERT INTO tasks (workspace_id, title, description, priority, worker_filter, max_retries, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, status, priority, created_at`,
      [workspaceId, title, description, priority, worker_filter, max_retries, userId]
    );

    const task = taskResult.rows[0];

    logger.task(`Task created: ${title}`, { taskId: task.id, workspaceId, userId });

    res.status(201).json({
      message: 'Task created successfully',
      task: task
    });

  } catch (error) {
    logger.error('Create task error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to create task'
    });
  }
});

// GET /tasks/:workspaceId/:taskId - Get specific task
router.get('/:workspaceId/:taskId', checkWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId, taskId } = req.params;

    const taskResult = await pool.query(
      `SELECT t.*, 
             w.name as assigned_worker_name,
             u.name as created_by_name
       FROM tasks t
       LEFT JOIN workers w ON t.assigned_worker_id = w.id
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.id = $1 AND t.workspace_id = $2`,
      [taskId, workspaceId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Task not found'
      });
    }

    // Get task logs
    const logsResult = await pool.query(
      `SELECT id, level, message, metadata, created_at
       FROM task_logs
       WHERE task_id = $1
       ORDER BY created_at ASC`,
      [taskId]
    );

    res.json({
      task: {
        ...taskResult.rows[0],
        logs: logsResult.rows
      }
    });

  } catch (error) {
    logger.error('Get task error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to get task'
    });
  }
});

// PUT /tasks/:workspaceId/:taskId/cancel - Cancel task
router.put('/:workspaceId/:taskId/cancel', checkWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId, taskId } = req.params;

    // Check if task exists and can be cancelled
    const taskResult = await pool.query(
      'SELECT id, status FROM tasks WHERE id = $1 AND workspace_id = $2',
      [taskId, workspaceId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Task not found'
      });
    }

    const task = taskResult.rows[0];

    if (!['pending', 'assigned', 'running'].includes(task.status)) {
      return res.status(400).json({
        error: 'Cannot Cancel',
        message: 'Task cannot be cancelled in its current status'
      });
    }

    // Cancel the task
    await pool.query(
      `UPDATE tasks 
       SET status = 'cancelled', 
           error_message = 'Cancelled by user',
           completed_at = NOW()
       WHERE id = $1`,
      [taskId]
    );

    logger.task(`Task cancelled: ${taskId}`, { workspaceId, userId: req.user.userId });

    res.json({
      message: 'Task cancelled successfully'
    });

  } catch (error) {
    logger.error('Cancel task error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to cancel task'
    });
  }
});

// DELETE /tasks/:workspaceId/:taskId - Delete task
router.delete('/:workspaceId/:taskId', checkWorkspaceAccess, async (req, res) => {
  try {
    const { workspaceId, taskId } = req.params;

    // Check if task exists
    const taskResult = await pool.query(
      'SELECT id, status FROM tasks WHERE id = $1 AND workspace_id = $2',
      [taskId, workspaceId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Task not found'
      });
    }

    const task = taskResult.rows[0];

    if (task.status === 'running') {
      return res.status(400).json({
        error: 'Cannot Delete',
        message: 'Cannot delete task that is currently running'
      });
    }

    // Delete task (logs will be cascade deleted)
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);

    logger.task(`Task deleted: ${taskId}`, { workspaceId, userId: req.user.userId });

    res.json({
      message: 'Task deleted successfully'
    });

  } catch (error) {
    logger.error('Delete task error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to delete task'
    });
  }
});

module.exports = router; 