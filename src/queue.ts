import { Queue, Worker, Job } from 'bullmq';
import { env } from './env';

const redisConnection = {
  host: env.REDISHOST,
  port: env.REDISPORT,
  username: env.REDISUSER,
  password: env.REDISPASSWORD,
};

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

const processWebhookJob = async (job: Job, queueType: 'HIGH' | 'LOW') => {
  console.log(`🔄 Processing ${queueType} priority job: ${job.name} - ID: ${job.id}`);

  try {
    const webhookData = job.data;
    console.log(`📦 ${queueType} priority job data:`, JSON.stringify(webhookData, null, 2));

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
  console.log('🚀 Setting up high-concurrency workers for maximum throughput...');

  const workers: Worker[] = [];

  // HIGH Priority: 1 worker with concurrency 3 (can process 3 HIGH jobs simultaneously)
  const highWorker = new Worker(
    'HighPriorityQueue',
    async (job: Job) => processWebhookJob(job, 'HIGH'),
    {
      connection: redisConnection,
      concurrency: 2, // Process up to 3 HIGH priority jobs at once
    }
  );

  highWorker.on('completed', (job, result) => {
    console.log(`✅ HIGH Worker completed job ${job.id} (${job.name})`);
  });

  highWorker.on('failed', (job, err) => {
    console.log(`❌ HIGH Worker failed job ${job?.id} (${job?.name}):`, err.message);
  });

  highWorker.on('error', (err) => {
    console.error(`🚨 HIGH Worker error:`, err);
  });

  workers.push(highWorker);

  // LOW Priority: 1 worker with concurrency 2 (can process 2 LOW jobs simultaneously when HIGH is empty)
  const lowWorker = new Worker(
    'LowPriorityQueue',
    async (job: Job) => processWebhookJob(job, 'LOW'),
    {
      connection: redisConnection,
      concurrency: 3, // Process up to 2 LOW priority jobs at once
    }
  );

  lowWorker.on('completed', (job, result) => {
    console.log(`✅ LOW Worker completed job ${job.id} (${job.name})`);
  });

  lowWorker.on('failed', (job, err) => {
    console.log(`❌ LOW Worker failed job ${job?.id} (${job?.name}):`, err.message);
  });

  lowWorker.on('error', (err) => {
    console.error(`🚨 LOW Worker error:`, err);
  });

  workers.push(lowWorker);

  console.log(`🎯 Created 2 high-concurrency workers:`);
  console.log(`   • 1 HIGH priority worker (concurrency: 3) = up to 3 simultaneous HIGH jobs`);
  console.log(`   • 1 LOW priority worker (concurrency: 2) = up to 2 simultaneous LOW jobs`);
  console.log(`⚡ Total capacity: 3 HIGH + 2 LOW = 5 jobs simultaneously`);
  console.log(`🚀 HIGH priority jobs always processed first, LOW only when HIGH queue is empty`);

  return workers;
};

// Legacy functions
export const createQueue = createHighPriorityQueue;