const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { pool } = require('../database/connection');
const logger = require('../utils/logger');
const router = express.Router();

// Helper function to generate workspace slug
function generateWorkspaceSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .trim('-'); // Remove leading/trailing hyphens
}

// Helper function to ensure unique slug
async function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let counter = 1;
  
  while (true) {
    const result = await pool.query('SELECT id FROM workspaces WHERE slug = $1', [slug]);
    if (result.rows.length === 0) {
      return slug;
    }
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

// Generate JWT tokens
function generateTokens(userId) {
  const accessToken = jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  
  return { accessToken, refreshToken };
}

// POST /auth/register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('company').optional().trim().isLength({ min: 1 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { email, password, name, company } = req.body;

    // Check if user already exists
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'User Already Exists',
        message: 'An account with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Start database transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Create user
      const userResult = await client.query(
        'INSERT INTO users (email, password_hash, name, email_verification_token) VALUES ($1, $2, $3, $4) RETURNING id, email, name, created_at',
        [email, passwordHash, name, uuidv4()]
      );
      
      const user = userResult.rows[0];

      // Create workspace
      const workspaceName = company || `${name}'s Workspace`;
      const baseSlug = generateWorkspaceSlug(workspaceName);
      const uniqueSlug = await ensureUniqueSlug(baseSlug);

      const workspaceResult = await client.query(
        'INSERT INTO workspaces (name, slug, plan, max_workers) VALUES ($1, $2, $3, $4) RETURNING id, name, slug, plan',
        [workspaceName, uniqueSlug, 'free', 2]
      );
      
      const workspace = workspaceResult.rows[0];

      // Add user as workspace owner
      await client.query(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
        [workspace.id, user.id, 'owner']
      );

      await client.query('COMMIT');

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens(user.id);

      logger.info(`New user registered: ${email}, workspace: ${uniqueSlug}`);

      res.status(201).json({
        message: 'Account created successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          plan: workspace.plan
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 900 // 15 minutes
        }
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration Failed',
      message: 'Failed to create account. Please try again.'
    });
  }
});

// POST /auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { email, password } = req.body;

    // Get user
    const userResult = await pool.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid Credentials',
        message: 'Email or password is incorrect'
      });
    }

    const user = userResult.rows[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Invalid Credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Get user's workspaces
    const workspacesResult = await pool.query(
      `SELECT w.id, w.name, w.slug, w.plan, wm.role 
       FROM workspaces w 
       JOIN workspace_members wm ON w.id = wm.workspace_id 
       WHERE wm.user_id = $1`,
      [user.id]
    );

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    logger.info(`User logged in: ${email}`);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      workspaces: workspacesResult.rows,
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      error: 'Login Failed',
      message: 'Failed to log in. Please try again.'
    });
  }
});

// POST /auth/refresh
router.post('/refresh', [
  body('refresh_token').notEmpty()
], async (req, res) => {
  try {
    const { refresh_token } = req.body;

    // Verify refresh token
    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        error: 'Invalid Token',
        message: 'Token type mismatch'
      });
    }

    // Check if user still exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1', [decoded.userId]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid Token',
        message: 'User not found'
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken } = generateTokens(decoded.userId);

    res.json({
      tokens: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Invalid Token',
        message: 'Refresh token is invalid or expired'
      });
    }

    logger.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Token Refresh Failed',
      message: 'Failed to refresh token'
    });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  // In a stateless JWT setup, logout is mainly client-side
  // Could implement token blacklisting if needed
  res.json({
    message: 'Logged out successfully'
  });
});

// GET /auth/me
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user with workspaces
    const userResult = await pool.query(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.last_login,
              json_agg(json_build_object(
                'id', w.id,
                'name', w.name,
                'slug', w.slug,
                'plan', w.plan,
                'role', wm.role
              )) as workspaces
       FROM users u
       LEFT JOIN workspace_members wm ON u.id = wm.user_id
       LEFT JOIN workspaces w ON wm.workspace_id = w.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        last_login: user.last_login
      },
      workspaces: user.workspaces.filter(w => w.id !== null) // Remove null workspace if user has none
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token'
      });
    }

    logger.error('Get user error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to get user information'
    });
  }
});

// POST /auth/forgot-password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    // Always return success for security (don't reveal if email exists)
    if (userResult.rows.length === 0) {
      return res.json({
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = uuidv4();
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour

    // Save reset token
    await pool.query(
      'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE email = $3',
      [resetToken, resetExpires, email]
    );

    // TODO: Send email with reset link
    // await sendPasswordResetEmail(email, resetToken);

    logger.info(`Password reset requested for: ${email}`);

    res.json({
      message: 'If an account with that email exists, a password reset link has been sent.'
    });

  } catch (error) {
    logger.error('Password reset error:', error);
    res.status(500).json({
      error: 'Server Error',
      message: 'Failed to process password reset request'
    });
  }
});

module.exports = router; 