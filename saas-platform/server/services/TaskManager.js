const { pool } = require('../database/connection');
const logger = require('../utils/logger');

class TaskManager {
  constructor(io, workerManager) {
    this.io = io;
    this.workerManager = workerManager;
    this.taskQueue = new Map(); // workspaceId -> array of pending tasks
    
    // Start task assignment loop
    this.startTaskProcessor();
  }

  // Create new task
  async createTask(workspaceId, userId, taskData) {
    try {
      const { title, description, priority = 'normal', worker_filter = {}, max_retries = 0 } = taskData;

      // Create task in database
      const taskResult = await pool.query(
        `INSERT INTO tasks (workspace_id, title, description, priority, worker_filter, max_retries, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, description, status, priority, created_at`,
        [workspaceId, title, description, priority, worker_filter, max_retries, userId]
      );

      const task = taskResult.rows[0];

      // Add to queue for processing
      this.addTaskToQueue(workspaceId, task);

      // Track usage metrics
      await pool.query(
        'INSERT INTO usage_metrics (workspace_id, metric_type, value, metadata) VALUES ($1, $2, $3, $4)',
        [workspaceId, 'task_created', 1, { task_id: task.id, priority }]
      );

      logger.task(`Task created: ${title}`, { taskId: task.id, workspaceId, userId });

      // Notify admin dashboard
      this.workerManager.notifyWorkspaceAdmins(workspaceId, 'task_created', task);

      return task;

    } catch (error) {
      logger.error('Error creating task:', error);
      throw new Error('Failed to create task');
    }
  }

  // Add task to processing queue
  addTaskToQueue(workspaceId, task) {
    if (!this.taskQueue.has(workspaceId)) {
      this.taskQueue.set(workspaceId, []);
    }
    
    const queue = this.taskQueue.get(workspaceId);
    
    // Insert task based on priority
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    const taskPriority = priorityOrder[task.priority] || 2;
    
    let insertIndex = queue.length;
    for (let i = 0; i < queue.length; i++) {
      const queueTaskPriority = priorityOrder[queue[i].priority] || 2;
      if (taskPriority < queueTaskPriority) {
        insertIndex = i;
        break;
      }
    }
    
    queue.splice(insertIndex, 0, task);
    
    logger.task(`Task queued: ${task.id} (position ${insertIndex + 1}/${queue.length})`);
  }

  // Complete task
  async completeTask(taskId, result) {
    try {
      const { status, result: taskResult, error_message, execution_time } = result;

      // Update task in database
      const updateResult = await pool.query(
        `UPDATE tasks SET 
           status = $1, 
           result = $2, 
           error_message = $3,
           execution_time_seconds = $4,
           completed_at = NOW()
         WHERE id = $5
         RETURNING workspace_id, assigned_worker_id, title`,
        [status, taskResult, error_message, execution_time, taskId]
      );

      if (updateResult.rows.length === 0) {
        throw new Error('Task not found');
      }

      const task = updateResult.rows[0];

      // Update worker status back to online if task completed successfully
      if (task.assigned_worker_id && status === 'completed') {
        await pool.query(
          'UPDATE workers SET status = $1, total_tasks_completed = total_tasks_completed + 1 WHERE id = $2',
          ['online', task.assigned_worker_id]
        );

        // Update average execution time
        if (execution_time) {
          await pool.query(
            `UPDATE workers SET 
               average_execution_time = (
                 COALESCE(average_execution_time, 0) * total_tasks_completed + $1
               ) / (total_tasks_completed + 1)
             WHERE id = $2`,
            [execution_time, task.assigned_worker_id]
          );
        }
      } else if (task.assigned_worker_id) {
        // Set worker back to online even if task failed
        await pool.query(
          'UPDATE workers SET status = $1 WHERE id = $2',
          ['online', task.assigned_worker_id]
        );
      }

      // Track completion metrics
      await pool.query(
        'INSERT INTO usage_metrics (workspace_id, metric_type, value, metadata) VALUES ($1, $2, $3, $4)',
        [
          task.workspace_id,
          status === 'completed' ? 'task_completed' : 'task_failed',
          1,
          { 
            task_id: taskId, 
            execution_time: execution_time,
            worker_id: task.assigned_worker_id
          }
        ]
      );

      logger.task(`Task ${status}: ${task.title}`, { 
        taskId, 
        workerId: task.assigned_worker_id,
        executionTime: execution_time 
      });

      // Notify admin dashboard
      this.workerManager.notifyWorkspaceAdmins(task.workspace_id, 'task_completed', {
        taskId: taskId,
        status: status,
        title: task.title,
        executionTime: execution_time,
        error: error_message
      });

      return { success: true };

    } catch (error) {
      logger.error('Error completing task:', error);
      throw new Error('Failed to complete task');
    }
  }

  // Add task log entry
  async addTaskLog(taskId, workerId, logData) {
    try {
      const { level, message, metadata = {} } = logData;

      await pool.query(
        'INSERT INTO task_logs (task_id, worker_id, level, message, metadata) VALUES ($1, $2, $3, $4, $5)',
        [taskId, workerId, level, message, metadata]
      );

      // Don't log debug messages to avoid spam
      if (level !== 'debug') {
        logger.task(`Task log [${level.toUpperCase()}]: ${message}`, { taskId, workerId });
      }

    } catch (error) {
      logger.error('Error adding task log:', error);
    }
  }

  // Get pending tasks for a workspace
  async getPendingTasks(workspaceId) {
    try {
      const result = await pool.query(
        `SELECT id, title, description, priority, worker_filter, max_retries, retry_count, created_at
         FROM tasks 
         WHERE workspace_id = $1 AND status = 'pending'
         ORDER BY priority DESC, created_at ASC`,
        [workspaceId]
      );

      return result.rows;

    } catch (error) {
      logger.error('Error getting pending tasks:', error);
      return [];
    }
  }

  // Retry failed task
  async retryTask(taskId) {
    try {
      // Get task details
      const taskResult = await pool.query(
        'SELECT id, workspace_id, retry_count, max_retries FROM tasks WHERE id = $1',
        [taskId]
      );

      if (taskResult.rows.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult.rows[0];

      if (task.retry_count >= task.max_retries) {
        throw new Error('Maximum retries exceeded');
      }

      // Reset task for retry
      await pool.query(
        `UPDATE tasks SET 
           status = 'pending',
           assigned_worker_id = NULL,
           result = NULL,
           error_message = NULL,
           retry_count = retry_count + 1,
           assigned_at = NULL,
           started_at = NULL,
           completed_at = NULL
         WHERE id = $1`,
        [taskId]
      );

      // Add back to queue
      const updatedTaskResult = await pool.query(
        'SELECT id, title, description, priority, worker_filter FROM tasks WHERE id = $1',
        [taskId]
      );

      this.addTaskToQueue(task.workspace_id, updatedTaskResult.rows[0]);

      logger.task(`Task retry initiated: ${taskId} (attempt ${task.retry_count + 1})`);

      return { success: true };

    } catch (error) {
      logger.error('Error retrying task:', error);
      throw error;
    }
  }

  // Cancel task
  async cancelTask(taskId) {
    try {
      const result = await pool.query(
        `UPDATE tasks SET 
           status = 'cancelled',
           error_message = 'Cancelled by user',
           completed_at = NOW()
         WHERE id = $1 AND status IN ('pending', 'assigned')
         RETURNING workspace_id, assigned_worker_id`,
        [taskId]
      );

      if (result.rows.length === 0) {
        throw new Error('Task not found or cannot be cancelled');
      }

      const task = result.rows[0];

      // If task was assigned to a worker, set worker back to online
      if (task.assigned_worker_id) {
        await pool.query(
          'UPDATE workers SET status = $1 WHERE id = $2',
          ['online', task.assigned_worker_id]
        );
      }

      // Remove from queue if it exists
      const queue = this.taskQueue.get(task.workspace_id);
      if (queue) {
        const index = queue.findIndex(t => t.id === taskId);
        if (index !== -1) {
          queue.splice(index, 1);
        }
      }

      logger.task(`Task cancelled: ${taskId}`);

      return { success: true };

    } catch (error) {
      logger.error('Error cancelling task:', error);
      throw error;
    }
  }

  // Get task statistics
  async getTaskStats(workspaceId) {
    try {
      const result = await pool.query(
        `SELECT 
           COUNT(*) as total_tasks,
           COUNT(*) FILTER (WHERE status = 'pending') as pending_tasks,
           COUNT(*) FILTER (WHERE status = 'assigned') as assigned_tasks,
           COUNT(*) FILTER (WHERE status = 'running') as running_tasks,
           COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks,
           COUNT(*) FILTER (WHERE status = 'failed') as failed_tasks,
           COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_tasks,
           AVG(execution_time_seconds) FILTER (WHERE status = 'completed') as avg_execution_time
         FROM tasks
         WHERE workspace_id = $1`,
        [workspaceId]
      );

      return result.rows[0];

    } catch (error) {
      logger.error('Error getting task stats:', error);
      return {
        total_tasks: 0,
        pending_tasks: 0,
        assigned_tasks: 0,
        running_tasks: 0,
        completed_tasks: 0,
        failed_tasks: 0,
        cancelled_tasks: 0,
        avg_execution_time: null
      };
    }
  }

  // Task processor - continuously assigns tasks to available workers
  startTaskProcessor() {
    setInterval(async () => {
      try {
        for (const [workspaceId, queue] of this.taskQueue.entries()) {
          if (queue.length === 0) continue;

          // Get available workers for this workspace
          const availableWorkers = await this.workerManager.getAvailableWorkers(workspaceId);
          
          if (availableWorkers.length === 0) continue;

          // Assign tasks to available workers
          let assignedCount = 0;
          while (queue.length > 0 && assignedCount < availableWorkers.length) {
            const task = queue.shift();
            
            // Double-check task is still pending in database
            const taskCheck = await pool.query(
              'SELECT id, workspace_id FROM tasks WHERE id = $1 AND status = $2',
              [task.id, 'pending']
            );

            if (taskCheck.rows.length === 0) {
              continue; // Task was cancelled or already assigned
            }

            // Assign task to worker
            const assignedWorker = await this.workerManager.assignTaskToWorker(task);
            
            if (assignedWorker) {
              assignedCount++;
              logger.task(`Auto-assigned task ${task.id} to worker ${assignedWorker.id}`);
            } else {
              // Put task back in queue if assignment failed
              queue.unshift(task);
              break;
            }
          }

          // Clean up empty queues
          if (queue.length === 0) {
            this.taskQueue.delete(workspaceId);
          }
        }

      } catch (error) {
        logger.error('Error in task processor:', error);
      }
    }, 5000); // Process every 5 seconds
  }

  // Get queue status for a workspace
  getQueueStatus(workspaceId) {
    const queue = this.taskQueue.get(workspaceId) || [];
    return {
      queueLength: queue.length,
      nextTask: queue.length > 0 ? queue[0] : null
    };
  }

  // Clear workspace queue (for testing or emergency)
  clearWorkspaceQueue(workspaceId) {
    this.taskQueue.delete(workspaceId);
    logger.task(`Cleared task queue for workspace: ${workspaceId}`);
  }
}

module.exports = TaskManager; 