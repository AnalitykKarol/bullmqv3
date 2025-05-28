import { ConnectionOptions, Queue, QueueScheduler, Worker } from 'bullmq';
import axios from 'axios';
import { env } from './env';

const connection: ConnectionOptions = {
  host: env.REDISHOST,
  port: env.REDISPORT,
  username: env.REDISUSER,
  password: env.REDISPASSWORD,
};

export const createQueue = (name: string) => new Queue(name, { connection });

export const setupQueueProcessor = async (queueName: string) => {
  const queueScheduler = new QueueScheduler(queueName, {
    connection,
  });
  await queueScheduler.waitUntilReady();

  new Worker(
    queueName,
    async (job) => {
      try {
        await job.updateProgress(10);
        await job.log(`Processing webhook job ${job.id} with priority: ${job.opts.priority}`);

        // Przekaż dane do n8n endpoint
        await job.updateProgress(50);
        await job.log(`Sending data to n8n endpoint`);

        const response = await axios.post(env.N8N_WEBHOOK_URL, job.data, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 sekund timeout
        });

        await job.updateProgress(90);
        await job.log(`Received response from n8n`);

        await job.updateProgress(100);
        await job.log(`Job completed successfully`);

        // Zwróć odpowiedź z n8n
        return {
          success: true,
          data: response.data,
          status: response.status,
        };
      } catch (error: any) {
        await job.log(`Error processing job: ${error.message}`);

        // Jeśli to błąd HTTP z n8n, zwróć szczegóły
        if (error.response) {
          throw new Error(`N8N Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        }

        // Inne błędy
        throw new Error(`Processing Error: ${error.message}`);
      }
    },
    {
      connection,
      concurrency: 5, // Obsługuj do 10 jobów jednocześnie
    }
  );
};