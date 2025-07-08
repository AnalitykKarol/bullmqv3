import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { QueueEvents } from 'bullmq';
import { env } from './env';

import {
  createHighPriorityQueue,
  createLowPriorityQueue,
  setupSmartWorkers
} from './queue';

interface WebhookRequest {
  Body: any;
}

interface AddJobQueryString {
  id?: string;
  email?: string;
}

const run = async () => {
  // Create shared queue instances
  const highPriorityQueue = createHighPriorityQueue();
  const lowPriorityQueue = createLowPriorityQueue();

  console.log('🚀 Created queue instances');

  // Setup smart workers with the same queue instances
  await setupSmartWorkers(highPriorityQueue, lowPriorityQueue);

  console.log('🧠 Smart workers setup completed');

  // Create QueueEvents for both queues
  const highPriorityQueueEvents = new QueueEvents('HighPriorityQueue', {
    connection: {
      host: env.REDISHOST,
      port: env.REDISPORT,
      username: env.REDISUSER,
      password: env.REDISPASSWORD,
    },
  });

  const lowPriorityQueueEvents = new QueueEvents('LowPriorityQueue', {
    connection: {
      host: env.REDISHOST,
      port: env.REDISPORT,
      username: env.REDISUSER,
      password: env.REDISPASSWORD,
    },
  });

  const server: FastifyInstance<Server, IncomingMessage, ServerResponse> =
    fastify();

  // Bull Board setup with both queues (Updated for v6.9.6)
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/admin');

  createBullBoard({
    queues: [
      new BullMQAdapter(highPriorityQueue),
      new BullMQAdapter(lowPriorityQueue)
    ],
    serverAdapter,
  });

  await server.register(serverAdapter.registerPlugin(), {
    prefix: '/admin',
  });

  // High Priority Webhook Endpoint
  server.post(
    '/webhook/high-priority',
    async (req: FastifyRequest<WebhookRequest>, reply) => {
      try {
        console.log('🚀 High priority webhook received:', req.body);
        const webhookData = req.body;

        // Add to HIGH priority queue (shared instance)
        const job = await highPriorityQueue.add(
          'high-priority-webhook',
          webhookData,
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          }
        );

        console.log(`✅ HIGH priority job added to queue: ${job.id}`);
        console.log('⏳ Waiting for HIGH priority job completion...');

        const result = await job.waitUntilFinished(highPriorityQueueEvents);
        console.log('✅ HIGH priority job completed:', result);

        if (result.success) {
          reply.status(result.status || 200).send(result.data);
        } else {
          reply.status(500).send({ error: 'Job failed', details: result });
        }
      } catch (error: any) {
        console.error('❌ High priority webhook error:', error);

        if (error.message.includes('N8N Error')) {
          const match = error.message.match(/N8N Error (\d+): (.+)/);
          if (match) {
            const status = parseInt(match[1]);
            const errorData = JSON.parse(match[2]);
            reply.status(status).send(errorData);
            return;
          }
        }

        reply.status(500).send({
          error: 'Internal server error',
          message: error.message
        });
      }
    }
  );

  // Low Priority Webhook Endpoint
  server.post(
    '/webhook/low-priority',
    async (req: FastifyRequest<WebhookRequest>, reply) => {
      try {
        console.log('🐌 Low priority webhook received:', req.body);
        const webhookData = req.body;

        // Add to LOW priority queue (shared instance)
        const job = await lowPriorityQueue.add(
          'low-priority-webhook',
          webhookData,
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          }
        );

        console.log(`✅ LOW priority job added to queue: ${job.id}`);
        console.log('⏳ Waiting for LOW priority job completion...');

        const result = await job.waitUntilFinished(lowPriorityQueueEvents);
        console.log('✅ LOW priority job completed:', result);

        if (result.success) {
          reply.status(result.status || 200).send(result.data);
        } else {
          reply.status(500).send({ error: 'Job failed', details: result });
        }
      } catch (error: any) {
        console.error('❌ Low priority webhook error:', error);

        if (error.message.includes('N8N Error')) {
          const match = error.message.match(/N8N Error (\d+): (.+)/);
          if (match) {
            const status = parseInt(match[1]);
            const errorData = JSON.parse(match[2]);
            reply.status(status).send(errorData);
            return;
          }
        }

        reply.status(500).send({
          error: 'Internal server error',
          message: error.message
        });
      }
    }
  );

  // Health check endpoint
  server.get('/health', async (request, reply) => {
    reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Legacy endpoint for compatibility (uses high priority queue)
  server.get(
    '/add-job',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            id: { type: 'string' },
            email: { type: 'string' },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Querystring: AddJobQueryString }>, reply) => {
      if (!req.query?.email || !req.query?.id) {
        reply
          .status(400)
          .send({ error: 'Requests must contain both an id and a email' });
        return;
      }

      const { email, id } = req.query;
      await highPriorityQueue.add(`TestJob-${id}`, { email, id });

      reply.send({ ok: true });
    }
  );

  await server.listen({ port: env.PORT, host: '0.0.0.0' });

  console.log(`🚀 Server is running on port ${env.PORT}`);
  console.log(`📊 Admin Dashboard: ${env.RAILWAY_STATIC_URL}/admin`);
  console.log(`📥 High Priority Webhook: ${env.RAILWAY_STATIC_URL}/webhook/high-priority`);
  console.log(`📥 Low Priority Webhook: ${env.RAILWAY_STATIC_URL}/webhook/low-priority`);
  console.log(`❤️ Health Check: ${env.RAILWAY_STATIC_URL}/health`);
  console.log(`🎯 Smart Workers: HIGH priority first, LOW when HIGH empty`);
  console.log(`⚡ Maximum efficiency: all workers utilized dynamically`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
