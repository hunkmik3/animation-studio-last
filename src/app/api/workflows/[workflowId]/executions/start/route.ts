import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  WORKFLOW_CONTINUATION_STATE_KEY,
  isWorkflowContinuationMarker,
} from '@/lib/workflow-engine/continuation'
import {
  WORKFLOW_EXECUTION_CURSOR_STATE_KEY,
  WORKFLOW_EXECUTION_LEASE_STATE_KEY,
  createWorkflowExecutionCursor,
  createWorkflowExecutionLease,
  isWorkflowExecutionCursor,
  isWorkflowExecutionLease,
  isWorkflowExecutionLeaseExpired,
} from '@/lib/workflow-engine/execution-authority'

type Params = { params: Promise<{ workflowId: string }> }

interface StartExecutionBody {
  runToken?: string
  graphSignature?: string
  clientInstanceId?: string
}

function toNodeStates(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function normalizeClientInstanceId(value: unknown, userId: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return `workflow_client_${userId}`
}

function conflict(reason: string, message: string) {
  return NextResponse.json({ granted: false, reason, message }, { status: 409 })
}

export const POST = apiHandler(async (request: NextRequest, context: Params) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { workflowId } = await context.params

  const body = (await request.json()) as StartExecutionBody
  const runToken = typeof body.runToken === 'string' ? body.runToken.trim() : ''
  const graphSignature = typeof body.graphSignature === 'string' ? body.graphSignature.trim() : ''
  if (!runToken || !graphSignature) {
    throw new ApiError('INVALID_PARAMS', {
      message: 'runToken and graphSignature are required',
    })
  }
  const clientInstanceId = normalizeClientInstanceId(body.clientInstanceId, session.user.id)

  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, userId: session.user.id },
    select: { id: true, updatedAt: true },
  })
  if (!workflow) throw new ApiError('NOT_FOUND')

  // Optimistic workflow-level lock to reduce cross-tab start races.
  const lockResult = await prisma.workflow.updateMany({
    where: {
      id: workflowId,
      userId: session.user.id,
      updatedAt: workflow.updatedAt,
    },
    data: { updatedAt: new Date() },
  })
  if (lockResult.count !== 1) {
    return conflict('start_race', 'Workflow state changed while starting run. Please retry.')
  }

  const openExecutions = await prisma.workflowExecution.findMany({
    where: {
      workflowId,
      userId: session.user.id,
      status: { in: ['running', 'pending'] },
    },
    orderBy: { createdAt: 'desc' },
  })

  const now = new Date()
  for (const execution of openExecutions) {
    const states = toNodeStates(execution.nodeStates)
    const lease = isWorkflowExecutionLease(states[WORKFLOW_EXECUTION_LEASE_STATE_KEY])
      ? states[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
      : null
    const continuation = isWorkflowContinuationMarker(states[WORKFLOW_CONTINUATION_STATE_KEY])
      ? states[WORKFLOW_CONTINUATION_STATE_KEY]
      : null
    const cursor = isWorkflowExecutionCursor(states[WORKFLOW_EXECUTION_CURSOR_STATE_KEY])
      ? states[WORKFLOW_EXECUTION_CURSOR_STATE_KEY]
      : null
    const leaseActive = lease ? !isWorkflowExecutionLeaseExpired(lease, now) : false

    if (leaseActive && lease && lease.holderClientId !== clientInstanceId) {
      return conflict('start_lease_held', 'Another session currently owns active execution lease.')
    }

    // Same client + same run token => idempotent start request.
    if (
      leaseActive
      && lease
      && lease.holderClientId === clientInstanceId
      && lease.runToken === runToken
    ) {
      return NextResponse.json({
        granted: true,
        alreadyRunning: true,
        executionId: execution.id,
        lease,
        cursor: cursor || (
          continuation && continuation.runToken === runToken
            ? createWorkflowExecutionCursor({
              runToken,
              graphSignature: continuation.graphSignature,
              phase: 'paused',
              nextIndex: continuation.nextIndex,
              currentNodeId: continuation.pausedNodeId,
              pausedNodeId: continuation.pausedNodeId,
              now,
            })
            : null
        ),
      })
    }

    if (
      leaseActive
      && lease
      && lease.holderClientId === clientInstanceId
      && lease.runToken !== runToken
    ) {
      return conflict(
        'start_active',
        'This session already has an active workflow run. Finish, resume, or fail it before starting a new run.',
      )
    }
  }

  // Close stale open executions that are not actively leased by others.
  if (openExecutions.length > 0) {
    const staleIds: string[] = []
    for (const execution of openExecutions) {
      const states = toNodeStates(execution.nodeStates)
      const lease = isWorkflowExecutionLease(states[WORKFLOW_EXECUTION_LEASE_STATE_KEY])
        ? states[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
        : null
      const leaseActive = lease ? !isWorkflowExecutionLeaseExpired(lease, now) : false
      if (!leaseActive) {
        staleIds.push(execution.id)
      }
    }
    if (staleIds.length > 0) {
      await prisma.workflowExecution.updateMany({
        where: {
          id: { in: staleIds },
          workflowId,
          userId: session.user.id,
          status: { in: ['running', 'pending'] },
        },
        data: {
          status: 'failed',
          completedAt: now,
          updatedAt: now,
        },
      })
    }
  }

  const lease = createWorkflowExecutionLease({
    runToken,
    holderClientId: clientInstanceId,
    now,
  })
  const cursor = createWorkflowExecutionCursor({
    runToken,
    graphSignature,
    phase: 'running',
    nextIndex: 0,
    currentNodeId: null,
    pausedNodeId: null,
    now,
  })

  const execution = await prisma.workflowExecution.create({
    data: {
      workflowId,
      userId: session.user.id,
      status: 'running',
      startedAt: now,
      nodeStates: JSON.stringify({
        [WORKFLOW_EXECUTION_LEASE_STATE_KEY]: lease,
        [WORKFLOW_EXECUTION_CURSOR_STATE_KEY]: cursor,
      }),
      outputData: JSON.stringify({}),
    },
    select: {
      id: true,
    },
  })

  return NextResponse.json({
    granted: true,
    alreadyRunning: false,
    executionId: execution.id,
    lease,
    cursor,
  })
})
