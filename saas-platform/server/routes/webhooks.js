const express = require('express');
const crypto = require('crypto');
const { pool } = require('../database/connection');
const logger = require('../utils/logger');
const router = express.Router();

// Stripe webhook endpoint
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!endpointSecret) {
      logger.error('Stripe webhook secret not configured');
      return res.status(500).send('Webhook secret not configured');
    }

    // Verify webhook signature (when using Stripe library)
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // let event;
    // try {
    //   event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    // } catch (err) {
    //   logger.error('Webhook signature verification failed:', err.message);
    //   return res.status(400).send(`Webhook Error: ${err.message}`);
    // }

    // For now, just parse the JSON
    const event = JSON.parse(req.body);

    logger.billing('Stripe webhook received:', { type: event.type, id: event.id });

    // Handle the event
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      
      default:
        logger.info('Unhandled Stripe webhook event type:', event.type);
    }

    res.json({ received: true });

  } catch (error) {
    logger.error('Stripe webhook error:', error);
    res.status(500).send('Webhook handler failed');
  }
});

// Handle subscription created
async function handleSubscriptionCreated(subscription) {
  try {
    // Find workspace by Stripe customer ID
    const workspaceResult = await pool.query(
      'SELECT id FROM workspaces WHERE stripe_customer_id = $1',
      [subscription.customer]
    );

    if (workspaceResult.rows.length === 0) {
      logger.error('Workspace not found for Stripe customer:', subscription.customer);
      return;
    }

    const workspaceId = workspaceResult.rows[0].id;

    // Create or update subscription record
    await pool.query(
      `INSERT INTO subscriptions 
       (workspace_id, stripe_subscription_id, plan, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (stripe_subscription_id) 
       DO UPDATE SET 
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end`,
      [
        workspaceId,
        subscription.id,
        subscription.items.data[0].price.lookup_key || 'unknown',
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000)
      ]
    );

    logger.billing('Subscription created:', { workspaceId, subscriptionId: subscription.id });

  } catch (error) {
    logger.error('Error handling subscription created:', error);
  }
}

// Handle subscription updated
async function handleSubscriptionUpdated(subscription) {
  try {
    await pool.query(
      `UPDATE subscriptions SET 
         plan = $1,
         status = $2,
         current_period_start = $3,
         current_period_end = $4,
         cancel_at_period_end = $5
       WHERE stripe_subscription_id = $6`,
      [
        subscription.items.data[0].price.lookup_key || 'unknown',
        subscription.status,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
        subscription.cancel_at_period_end,
        subscription.id
      ]
    );

    logger.billing('Subscription updated:', { subscriptionId: subscription.id });

  } catch (error) {
    logger.error('Error handling subscription updated:', error);
  }
}

// Handle subscription deleted
async function handleSubscriptionDeleted(subscription) {
  try {
    await pool.query(
      'UPDATE subscriptions SET status = $1 WHERE stripe_subscription_id = $2',
      ['canceled', subscription.id]
    );

    // Downgrade workspace to free plan
    const workspaceResult = await pool.query(
      'SELECT workspace_id FROM subscriptions WHERE stripe_subscription_id = $1',
      [subscription.id]
    );

    if (workspaceResult.rows.length > 0) {
      await pool.query(
        'UPDATE workspaces SET plan = $1, max_workers = $2 WHERE id = $3',
        ['free', 2, workspaceResult.rows[0].workspace_id]
      );
    }

    logger.billing('Subscription deleted:', { subscriptionId: subscription.id });

  } catch (error) {
    logger.error('Error handling subscription deleted:', error);
  }
}

// Handle payment succeeded
async function handlePaymentSucceeded(invoice) {
  try {
    logger.billing('Payment succeeded:', { 
      invoiceId: invoice.id, 
      amount: invoice.amount_paid,
      customer: invoice.customer
    });

    // Track usage metrics
    const workspaceResult = await pool.query(
      'SELECT id FROM workspaces WHERE stripe_customer_id = $1',
      [invoice.customer]
    );

    if (workspaceResult.rows.length > 0) {
      await pool.query(
        'INSERT INTO usage_metrics (workspace_id, metric_type, value, metadata) VALUES ($1, $2, $3, $4)',
        [
          workspaceResult.rows[0].id,
          'payment_succeeded',
          invoice.amount_paid,
          { invoice_id: invoice.id }
        ]
      );
    }

  } catch (error) {
    logger.error('Error handling payment succeeded:', error);
  }
}

// Handle payment failed
async function handlePaymentFailed(invoice) {
  try {
    logger.billing('Payment failed:', { 
      invoiceId: invoice.id, 
      customer: invoice.customer 
    });

    // Track payment failure
    const workspaceResult = await pool.query(
      'SELECT id FROM workspaces WHERE stripe_customer_id = $1',
      [invoice.customer]
    );

    if (workspaceResult.rows.length > 0) {
      await pool.query(
        'INSERT INTO usage_metrics (workspace_id, metric_type, value, metadata) VALUES ($1, $2, $3, $4)',
        [
          workspaceResult.rows[0].id,
          'payment_failed',
          1,
          { invoice_id: invoice.id }
        ]
      );
    }

  } catch (error) {
    logger.error('Error handling payment failed:', error);
  }
}

module.exports = router; 