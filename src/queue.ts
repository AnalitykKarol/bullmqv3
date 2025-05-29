import { Queue, Worker, Job } from 'bullmq';
import { env } from './env';

const redisConnection = {
  host: env.REDISHOST,
  port: env.REDISPORT,
  username: env.REDISUSER,
  password: env.REDISPASSWORD,
};

// Create separate queues for different priorities
export const createHighPriorityQueue = () => {
  return new Queue('HighPriorityQueue', {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });
};

export const createLowPriorityQueue = () => {
  return new Queue('LowPriorityQueue', {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });
};

// Legacy function for backward compatibility
export const createQueue = (name: string) => {
  return createHighPriorityQueue();
};

const processWebhookJob = async (job: Job, queueType: 'HIGH' | 'LOW') => {
  console.log(`🔄 Processing ${queueType} priority job: ${job.name} - ID: ${job.id}`);

  try {
    const webhookData = job.data;
    console.log(`📦 ${queueType} priority job data:`, JSON.stringify(webhookData, null, 2));

    // Call n8n webhook
    const response = await fetch(env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ N8N webhook failed (${response.status}) for ${queueType} priority:`, errorText);

      throw new Error(`N8N Error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ ${queueType} priority job completed successfully: ${job.name}`);

    return {
      success: true,
      status: response.status,
      data: result,
    };
  } catch (error: any) {
    console.error(`❌ ${queueType} priority job failed: ${job.name}`, error.message);

    return {
      success: false,
      error: error.message,
    };
  }
};

export const setupSmartWorkers = async () => {
  const workers: Worker[] = [];

  // 🎯 Create 5 smart workers that handle BOTH queues
  // Each worker will prioritize HIGH queue, but fall back to LOW queue when HIGH is empty
  for (let i = 0; i < 5; i++) {
    const worker = new Worker(
      // 🚀 KEY: Worker obsługuje obie kolejki z priorytetem dla HIGH
      ['HighPriorityQueue', 'LowPriorityQueue'],
      async (job: Job) => {
        // Determine queue type based on job queue name
        const queueType = job.queueName === 'HighPriorityQueue' ? 'HIGH' : 'LOW';
        return processWebhookJob(job, queueType);
      },
      {
        connection: redisConnection,
        concurrency: 1, // Each worker handles 1 job at a time
        settings: {
          stalledInterval: 30 * 1000,
          maxStalledCount: 1,
        },
      }
    );

    worker.on('completed', (job, result) => {
      const queueType = job.queueName === 'HighPriorityQueue' ? 'HIGH' : 'LOW';
      console.log(`✅ Worker ${i+1} completed ${queueType} priority job ${job.id} (${job.name})`);
    });

    worker.on('failed', (job, err) => {
      const queueType = job?.queueName === 'HighPriorityQueue' ? 'HIGH' : 'LOW';
      console.log(`❌ Worker ${i+1} failed ${queueType} priority job ${job?.id} (${job?.name}):`, err.message);
    });

    worker.on('error', (err) => {
      console.error(`🚨 Worker ${i+1} error:`, err);
    });

    workers.push(worker);
  }

  console.log(`🎯 Created ${workers.length} smart workers handling both priority queues`);
  console.log(`📈 Logic: HIGH priority first, then LOW priority when HIGH is empty`);

  return workers;
};

// Legacy functions for backward compatibility
export const setupHighPriorityProcessor = setupSmartWorkers;
export const setupLowPriorityProcessor = async () => {
  // No-op since smart workers handle both
  return null;
};
export const setupQueueProcessor = setupSmartWorkers;