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

// Global state to track queue load and dynamically adjust workers
let highPriorityWorkers: Worker[] = [];
let lowPriorityWorkers: Worker[] = [];

export const setupSmartWorkers = async () => {
  console.log('🚀 Setting up smart load-balanced workers...');

  // Create HIGH priority workers (start with 3)
  for (let i = 0; i < 3; i++) {
    const worker = new Worker(
      'HighPriorityQueue',
      async (job: Job) => processWebhookJob(job, 'HIGH'),
      {
        connection: redisConnection,
        concurrency: 1,
      }
    );

    worker.on('completed', (job, result) => {
      console.log(`✅ HIGH Worker ${i+1} completed job ${job.id} (${job.name})`);
    });

    worker.on('failed', (job, err) => {
      console.log(`❌ HIGH Worker ${i+1} failed job ${job?.id} (${job?.name}):`, err.message);
    });

    worker.on('error', (err) => {
      console.error(`🚨 HIGH Worker ${i+1} error:`, err);
    });

    highPriorityWorkers.push(worker);
  }

  // Create LOW priority workers (start with 2)
  for (let i = 0; i < 2; i++) {
    const worker = new Worker(
      'LowPriorityQueue',
      async (job: Job) => processWebhookJob(job, 'LOW'),
      {
        connection: redisConnection,
        concurrency: 1,
      }
    );

    worker.on('completed', (job, result) => {
      console.log(`✅ LOW Worker ${i+1} completed job ${job.id} (${job.name})`);
    });

    worker.on('failed', (job, err) => {
      console.log(`❌ LOW Worker ${i+1} failed job ${job?.id} (${job?.name}):`, err.message);
    });

    worker.on('error', (err) => {
      console.error(`🚨 LOW Worker ${i+1} error:`, err);
    });

    lowPriorityWorkers.push(worker);
  }

  console.log(`🎯 Created ${highPriorityWorkers.length} HIGH priority workers`);
  console.log(`🐌 Created ${lowPriorityWorkers.length} LOW priority workers`);
  console.log(`⚡ Total: ${highPriorityWorkers.length + lowPriorityWorkers.length} workers active`);

  return [...highPriorityWorkers, ...lowPriorityWorkers];
};

// Advanced version with dynamic scaling (for future implementation)
export const setupDynamicWorkers = async () => {
  console.log('🧠 Setting up dynamic worker scaling...');

  // Start with balanced allocation
  const workers = await setupSmartWorkers();

  // TODO: Future enhancement - monitor queue sizes and dynamically reassign workers
  // This could check queue.getWaiting() periodically and spawn/kill workers as needed

  return workers;
};

// Legacy functions for backward compatibility
export const setupHighPriorityProcessor = setupSmartWorkers;
export const setupLowPriorityProcessor = async () => {
  // No-op since smart workers handle both
  return null;
};
export const setupQueueProcessor = setupSmartWorkers;