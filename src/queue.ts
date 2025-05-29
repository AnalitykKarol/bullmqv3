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

interface SmartWorker {
  worker: Worker;
  currentQueue: 'HIGH' | 'LOW';
  id: number;
}

let smartWorkers: SmartWorker[] = [];
let highQueue: Queue;
let lowQueue: Queue;

const createWorkerForQueue = (queueName: string, queueType: 'HIGH' | 'LOW', workerId: number): Worker => {
  const worker = new Worker(
    queueName,
    async (job: Job) => processWebhookJob(job, queueType),
    {
      connection: redisConnection,
      concurrency: 1, // Każdy worker przetwarza 1 job jednocześnie
    }
  );

  worker.on('completed', (job, result) => {
    console.log(`✅ Worker ${workerId} (${queueType}) completed job ${job.id} (${job.name})`);
  });

  worker.on('failed', (job, err) => {
    console.log(`❌ Worker ${workerId} (${queueType}) failed job ${job?.id} (${job?.name}):`, err.message);
  });

  worker.on('error', (err) => {
    console.error(`🚨 Worker ${workerId} (${queueType}) error:`, err);
  });

  return worker;
};

const switchWorkerToQueue = async (smartWorker: SmartWorker, newQueueType: 'HIGH' | 'LOW') => {
  if (smartWorker.currentQueue === newQueueType) return;

  console.log(`🔄 Switching Worker ${smartWorker.id} from ${smartWorker.currentQueue} to ${newQueueType}`);

  // Zatrzymaj obecny worker
  await smartWorker.worker.close();

  // Utwórz nowy worker dla innej kolejki
  const queueName = newQueueType === 'HIGH' ? 'HighPriorityQueue' : 'LowPriorityQueue';
  smartWorker.worker = createWorkerForQueue(queueName, newQueueType, smartWorker.id);
  smartWorker.currentQueue = newQueueType;
};

const monitorAndRebalance = async () => {
  try {
    // Sprawdź ile jobów czeka w HIGH queue
    const highWaitingJobs = await highQueue.getWaiting();
    const highJobsCount = highWaitingJobs.length;

    console.log(`📊 HIGH queue jobs waiting: ${highJobsCount}`);

    // Logika przełączania:
    // HIGH >= 5 jobów → wszystkie 5 workerów na HIGH
    // HIGH = 0 jobów → wszystkie 5 workerów na LOW
    // HIGH 1-4 joby → wszystkie 5 workerów na HIGH (priorytet)

    let targetQueue: 'HIGH' | 'LOW';

    if (highJobsCount >= 5) {
      targetQueue = 'HIGH';
      console.log(`🚀 HIGH overload (${highJobsCount} jobs) → All 5 workers to HIGH`);
    } else if (highJobsCount === 0) {
      targetQueue = 'LOW';
      console.log(`🐌 HIGH empty → All 5 workers to LOW`);
    } else {
      targetQueue = 'HIGH';
      console.log(`⚡ HIGH has ${highJobsCount} jobs → All 5 workers to HIGH (priority)`);
    }

    // Przełącz wszystkich workerów na target queue
    const switchPromises = smartWorkers.map(worker =>
      switchWorkerToQueue(worker, targetQueue)
    );

    await Promise.all(switchPromises);

    const currentDistribution = smartWorkers.reduce((acc, w) => {
      acc[w.currentQueue] = (acc[w.currentQueue] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`👥 Current distribution: HIGH=${currentDistribution.HIGH || 0}, LOW=${currentDistribution.LOW || 0}`);

  } catch (error) {
    console.error('❌ Error in queue monitoring:', error);
  }
};

export const setupSmartWorkers = async () => {
  console.log('🧠 Setting up 5 intelligent switching workers...');

  highQueue = createHighPriorityQueue();
  lowQueue = createLowPriorityQueue();

  // Utwórz 5 smart workerów - wszystkie startują na HIGH
  for (let i = 0; i < 5; i++) {
    const worker = createWorkerForQueue('HighPriorityQueue', 'HIGH', i + 1);

    smartWorkers.push({
      worker,
      currentQueue: 'HIGH',
      id: i + 1,
    });
  }

  console.log(`🎯 Created 5 smart workers (all starting on HIGH)`);
  console.log(`🤖 Intelligence: HIGH ≥5 jobs → all HIGH, HIGH = 0 → all LOW`);

  // Start monitoring every 3 seconds
  setInterval(monitorAndRebalance, 3000);

  // Run initial rebalance
  await monitorAndRebalance();

  return smartWorkers.map(sw => sw.worker);
};

// Legacy functions
export const createQueue = createHighPriorityQueue;