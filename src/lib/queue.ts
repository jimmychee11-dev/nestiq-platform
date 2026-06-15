import { Queue } from "bullmq";
import { QUEUE_NAME, redis } from "./redis";

export interface AgentJobData {
  taskId: string;
}

export const agentTaskQueue = new Queue<AgentJobData, void, string>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // The engine converts the final failed attempt into AWAITING_HUMAN_REVIEW;
    // intermediate failures retry with exponential backoff.
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  },
});

export async function enqueueTask(taskId: string): Promise<void> {
  // jobId must be unique per enqueue — BullMQ silently drops re-adds that
  // collide with a completed job's id, which would break human-resume.
  await agentTaskQueue.add("run-task", { taskId }, { jobId: `task:${taskId}:${Date.now()}` });
}
