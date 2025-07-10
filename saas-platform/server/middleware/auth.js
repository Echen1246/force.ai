const jwt = require('jsonwebtoken');
const { pool } = require('../database/connection');
const logger = require('../utils/logger');

// Middleware to authenticate user JWT tokens
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.type !== 'access') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token type'
        });
      }

      // Verify user still exists in database
      const userResult = await pool.query(
        'SELECT id, email, name FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'User not found'
        });
      }

      // Add user info to request object
      req.user = {
        userId: decoded.userId,
        email: userResult.rows[0].email,
        name: userResult.rows[0].name
      };

      next();

    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token Expired',
          message: 'Authentication token has expired'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Invalid Token',
          message: 'Authentication token is invalid'
        });
      } else {
        throw jwtError;
      }
    }

  } catch (error) {
    logger.error('Authentication middleware error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Authentication failed'
    });
  }
}

// Middleware to authenticate worker JWT tokens
async function authenticateWorker(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.type !== 'worker') {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token type'
        });
      }

      // Verify worker still exists in database
      const workerResult = await pool.query(
        'SELECT id, workspace_id, name, status FROM workers WHERE id = $1',
        [decoded.workerId]
      );

      if (workerResult.rows.length === 0) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Worker not found'
        });
      }

      const worker = workerResult.rows[0];

      // Add worker info to request object
      req.worker = {
        workerId: decoded.workerId,
        workspaceId: decoded.workspaceId,
        name: worker.name,
        status: worker.status
      };

      next();

    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token Expired',
          message: 'Worker authentication token has expired'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Invalid Token',
          message: 'Worker authentication token is invalid'
        });
      } else {
        throw jwtError;
      }
    }

  } catch (error) {
    logger.error('Worker authentication middleware error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Worker authentication failed'
    });
  }
}

// Middleware to check workspace access
async function checkWorkspaceAccess(req, res, next) {
  try {
    const workspaceId = req.params.workspaceId || req.body.workspace_id;
    const userId = req.user.userId;

    if (!workspaceId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Workspace ID is required'
      });
    }

    // Check if user has access to this workspace
    const accessResult = await pool.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    if (accessResult.rows.length === 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied to this workspace'
      });
    }

    // Add workspace access info to request
    req.workspace = {
      id: workspaceId,
      userRole: accessResult.rows[0].role
    };

    next();

  } catch (error) {
    logger.error('Workspace access check error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to verify workspace access'
    });
  }
}

// Middleware to check if user has admin role in workspace
async function requireWorkspaceAdmin(req, res, next) {
  try {
    if (!req.workspace) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Workspace access check must be run first'
      });
    }

    const adminRoles = ['owner', 'admin'];
    
    if (!adminRoles.includes(req.workspace.userRole)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required for this operation'
      });
    }

    next();

  } catch (error) {
    logger.error('Admin check error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to verify admin access'
    });
  }
}

// Middleware to validate API key for external integrations
async function authenticateAPIKey(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API key is required'
      });
    }

    // Hash the provided API key for comparison
    const crypto = require('crypto');
    const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Find the API token in database
    const tokenResult = await pool.query(
      `SELECT at.*, w.id as workspace_id, w.name as workspace_name
       FROM api_tokens at
       JOIN workspaces w ON at.workspace_id = w.id
       WHERE at.token_hash = $1 AND (at.expires_at IS NULL OR at.expires_at > NOW())`,
      [hashedKey]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired API key'
      });
    }

    const token = tokenResult.rows[0];

    // Update last used timestamp
    await pool.query(
      'UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1',
      [token.id]
    );

    // Add API key info to request
    req.apiKey = {
      id: token.id,
      name: token.name,
      workspaceId: token.workspace_id,
      workspaceName: token.workspace_name,
      permissions: token.permissions
    };

    next();

  } catch (error) {
    logger.error('API key authentication error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'API key authentication failed'
    });
  }
}

// Optional authentication - doesn't fail if no token provided
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth provided, continue without user info
      return next();
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (decoded.type === 'access') {
        // Get user info
        const userResult = await pool.query(
          'SELECT id, email, name FROM users WHERE id = $1',
          [decoded.userId]
        );

        if (userResult.rows.length > 0) {
          req.user = {
            userId: decoded.userId,
            email: userResult.rows[0].email,
            name: userResult.rows[0].name
          };
        }
      }
    } catch (jwtError) {
      // Invalid token, but continue without auth
      logger.debug('Optional auth failed:', jwtError.message);
    }

    next();

  } catch (error) {
    logger.error('Optional authentication error:', error);
    // Don't fail the request, just continue without auth
    next();
  }
}

module.exports = {
  authenticateToken,
  authenticateWorker,
  checkWorkspaceAccess,
  requireWorkspaceAdmin,
  authenticateAPIKey,
  optionalAuth
}; 