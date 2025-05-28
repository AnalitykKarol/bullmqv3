import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';
import { QueueEvents } from 'bullmq';
import { env } from './env';

import { createQueue, setupQueueProcessor } from './queue';

interface WebhookRequest {
  Body: any;
}

interface AddJobQueryString {
  id?: string;
  email?: string;
}

const run = async () => {
  const webhookQueue = createQueue('WebhookQueue');
  await setupQueueProcessor(webhookQueue.name);

  // Create QueueEvents for waitUntilFinished
  const queueEvents = new QueueEvents('WebhookQueue', {
    connection: {
      host: env.REDISHOST,
      port: env.REDISPORT,
      username: env.REDISUSER,
      password: env.REDISPASSWORD,
    },
  });

  const server: FastifyInstance<Server, IncomingMessage, ServerResponse> =
    fastify();

  const serverAdapter = new FastifyAdapter();
  createBullBoard({
    queues: [new BullMQAdapter(webhookQueue)],
    serverAdapter,
  });
  serverAdapter.setBasePath('/admin');
  server.register(serverAdapter.registerPlugin(), {
    prefix: '/admin',
    basePath: '/admin',
  });

  // High Priority Webhook Endpoint
  server.post(
    '/webhook/high-priority',
    async (req: FastifyRequest<WebhookRequest>, reply) => {
      try {
        const webhookData = req.body;
        
        const job = await webhookQueue.add(
          'high-priority-webhook',
          webhookData,
          {
            priority: 10,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          }
        );

        // Wait for job completion with QueueEvents
        const result = await job.waitUntilFinished(queueEvents);

        if (result.success) {
          reply.status(result.status || 200).send(result.data);
        } else {
          reply.status(500).send({ error: 'Job failed', details: result });
        }
      } catch (error: any) {
        console.error('High priority webhook error:', error);
        
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
        const webhookData = req.body;
        
        const job = await webhookQueue.add(
          'low-priority-webhook',
          webhookData,
          {
            priority: 1,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          }
        );

        // Wait for job completion with QueueEvents
        const result = await job.waitUntilFinished(queueEvents);

        if (result.success) {
          reply.status(result.status || 200).send(result.data);
        } else {
          reply.status(500).send({ error: 'Job failed', details: result });
        }
      } catch (error: any) {
        console.error('Low priority webhook error:', error);
        
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

  // Legacy endpoint for compatibility
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
      await webhookQueue.add(`TestJob-${id}`, { email, id });

      reply.send({ ok: true });
    }
  );

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  
  console.log(`🚀 Server is running on port ${env.PORT}`);
  console.log(`📊 Admin Dashboard: https://${env.RAILWAY_STATIC_URL}/admin`);
  console.log(`📥 High Priority Webhook: https://${env.RAILWAY_STATIC_URL}/webhook/high-priority`);
  console.log(`📥 Low Priority Webhook: https://${env.RAILWAY_STATIC_URL}/webhook/low-priority`);
  console.log(`❤️ Health Check: https://${env.RAILWAY_STATIC_URL}/health`);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
