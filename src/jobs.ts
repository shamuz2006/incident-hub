/**
 * Background jobs, run by AppJobRoom (worker.ts). Jobs are only enqueued by
 * server actions after an authorization check — browsers can't enqueue.
 *
 * Each handler records its own progress on a team-scoped record so the UI
 * updates live. Throwing makes the queue retry (up to maxAttempts, default 3).
 *
 * Jobs act as the app owner (tools bypass RBAC), so every handler only
 * touches the incident named in its payload.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { createActionTools } from './server/action-routes'
import { runPostmortemJob, type PostmortemJobPayload } from './jobs/postmortem-job'
import { runSlackJob, type SlackJobPayload } from './jobs/slack-job'
import { runSummaryJob, type SummaryJobPayload } from './jobs/summary-job'

export async function runJob(job: Job, _ctx: JobContext, env: Env): Promise<unknown> {
  const tools = createActionTools(env, env.OWNER_USER_ID, env.APP_OWNER_JWT)
  const opts = {
    jobId: job.id,
    attempt: job.attempts,
    isFinalAttempt: job.attempts >= job.maxAttempts,
    allowSimulation: env.ALLOW_DEBUG_ROUTES === 'true',
  }
  switch (job.type) {
    case 'ai-summary':
      return runSummaryJob(job.payload as SummaryJobPayload, tools, opts)
    case 'ai-postmortem':
      return runPostmortemJob(job.payload as PostmortemJobPayload, tools, opts)
    case 'slack-notify':
      // Links in Slack point at the deployed app.
      return runSlackJob(job.payload as SlackJobPayload, tools, { ...opts, appOrigin: `https://${env.APP_NAME}.app.space` })
    default:
      throw new Error(`Unknown job type: ${job.type}`)
  }
}
