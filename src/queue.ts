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
  try {
    const webhookData = job.data;

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

    return {
      success: true,
      status: response.status,
      data: result,
    };
  } catch (error: any) {
    console.error(`❌ ${queueType} priority job failed: ${job.name}`, error.message);
    throw error; // Re-throw to let BullMQ handle retries
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
let monitoringInterval: NodeJS.Timeout | null = null;

const createWorkerForQueue = (queueName: string, queueType: 'HIGH' | 'LOW', workerId: number): Worker => {
  const worker = new Worker(
    queueName,
    async (job: Job) => processWebhookJob(job, queueType),
    {
      connection: redisConnection,
      concurrency: 1, // Każdy worker przetwarza 1 job jednocześnie
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`❌ Worker ${workerId} (${queueType}) failed job ${job?.id} (${job?.name}):`, err.message);
  });

  worker.on('error', (err) => {
    console.error(`🚨 Worker ${workerId} (${queueType}) error:`, err);
  });

  return worker;
};

const switchWorkerToQueue = async (smartWorker: SmartWorker, newQueueType: 'HIGH' | 'LOW') => {
  if (smartWorker.currentQueue === newQueueType) return;

  try {
    // Zatrzymaj obecny worker
    await smartWorker.worker.close();

    // Utwórz nowy worker dla innej kolejki
    const queueName = newQueueType === 'HIGH' ? 'HighPriorityQueue' : 'LowPriorityQueue';
    smartWorker.worker = createWorkerForQueue(queueName, newQueueType, smartWorker.id);
    smartWorker.currentQueue = newQueueType;
  } catch (error) {
    console.error(`❌ Error switching worker ${smartWorker.id}:`, error);
    throw error;
  }
};

const monitorAndRebalance = async () => {
  try {
    // VERIFICATION: Check if we still have exactly 5 workers
    if (smartWorkers.length !== 5) {
      console.error(`⚠️  WARNING: Expected 5 workers, but have ${smartWorkers.length}!`);
      return;
    }

    // Sprawdź ile jobów czeka w HIGH queue
    const highWaitingJobs = await highQueue.getWaiting();
    const highJobsCount = highWaitingJobs.length;

    // Logika przełączania:
    // HIGH >= 5 jobów → wszystkie 5 workerów na HIGH
    // HIGH = 0 jobów → wszystkie 5 workerów na LOW
    // HIGH 1-4 joby → wszystkie 5 workerów na HIGH (priorytet)

    let targetQueue: 'HIGH' | 'LOW';

    if (highJobsCount >= 5) {
      targetQueue = 'HIGH';
    } else if (highJobsCount === 0) {
      targetQueue = 'LOW';
    } else {
      targetQueue = 'HIGH';
    }

    // Przełącz wszystkich workerów na target queue
    const switchPromises = smartWorkers.map(worker =>
      switchWorkerToQueue(worker, targetQueue)
    );

    await Promise.all(switchPromises);

  } catch (error) {
    console.error('❌ Error in queue monitoring:', error);
  }
};

export const setupSmartWorkers = async (
  highPriorityQueue: Queue,
  lowPriorityQueue: Queue
) => {
  // SAFETY: Close any existing workers first
  if (smartWorkers.length > 0) {
    await shutdownWorkers();
  }

  // Use the provided queue instances (SHARED with server)
  highQueue = highPriorityQueue;
  lowQueue = lowPriorityQueue;

  // GUARANTEE: Create exactly 5 workers
  for (let i = 0; i < 5; i++) {
    const worker = createWorkerForQueue('HighPriorityQueue', 'HIGH', i + 1);

    smartWorkers.push({
      worker,
      currentQueue: 'HIGH',
      id: i + 1,
    });
  }

  // VERIFICATION: Ensure we have exactly 5 workers
  if (smartWorkers.length !== 5) {
    throw new Error(`❌ Expected 5 workers, but got ${smartWorkers.length}`);
  }

  // Start monitoring every 3 seconds
  monitoringInterval = setInterval(monitorAndRebalance, 3000);

  // Run initial rebalance
  await monitorAndRebalance();

  return smartWorkers.map(sw => sw.worker);
};

// Legacy functions
export const createQueue = createHighPriorityQueue;

// Graceful shutdown function
export const shutdownWorkers = async () => {
  // Clear monitoring interval
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }

  if (smartWorkers.length === 0) {
    return;
  }

  try {
    // Close all workers gracefully
    const shutdownPromises = smartWorkers.map(async (sw) => {
      try {
        await sw.worker.close();
      } catch (error) {
        console.error(`❌ Error shutting down worker ${sw.id}:`, error);
      }
    });

    await Promise.all(shutdownPromises);
    smartWorkers = [];
  } catch (error) {
    console.error('❌ Error during worker shutdown:', error);
    // Force clear the array even if some workers failed to close
    smartWorkers = [];
  }
};

// Auto cleanup on process termination
process.on('SIGTERM', async () => {
  await shutdownWorkers();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await shutdownWorkers();
  process.exit(0);
});
