import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  WORKFLOW_CONTINUATION_STATE_KEY,
  isWorkflowContinuationMarker,
  type WorkflowContinuationMarker,
} from '@/lib/workflow-engine/continuation'
import {
  WORKFLOW_EXECUTION_LEASE_STATE_KEY,
  createWorkflowExecutionLease,
  isWorkflowExecutionLease,
  isWorkflowExecutionLeaseExpired,
} from '@/lib/workflow-engine/execution-authority'

type Params = { params: Promise<{ workflowId: string }> }

interface ResumeExecutionBody {
  executionId?: string
  continuation?: WorkflowContinuationMarker
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

function conflictResponse(reason: string, message: string) {
  return NextResponse.json(
    {
      granted: false,
      reason,
      message,
    },
    { status: 409 },
  )
}

function normalizeClientInstanceId(value: unknown, userId: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return `workflow_client_${userId}`
}

function sameContinuation(
  left: WorkflowContinuationMarker,
  right: WorkflowContinuationMarker,
): boolean {
  if (left.runToken !== right.runToken) return false
  if (left.pausedNodeId !== right.pausedNodeId) return false
  if (left.nextIndex !== right.nextIndex) return false
  if (left.graphSignature !== right.graphSignature) return false
  return true
}

export const POST = apiHandler(async (request: NextRequest, context: Params) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { workflowId } = await context.params

  const body = (await request.json()) as ResumeExecutionBody
  const executionId = typeof body.executionId === 'string' ? body.executionId : ''
  if (!executionId) {
    throw new ApiError('INVALID_PARAMS', { message: 'executionId is required' })
  }
  if (!isWorkflowContinuationMarker(body.continuation)) {
    throw new ApiError('INVALID_PARAMS', { message: 'continuation payload is invalid' })
  }
  const requestedContinuation = body.continuation
  const clientInstanceId = normalizeClientInstanceId(body.clientInstanceId, session.user.id)

  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, userId: session.user.id },
    select: { id: true },
  })
  if (!workflow) throw new ApiError('NOT_FOUND')

  const execution = await prisma.workflowExecution.findFirst({
    where: {
      id: executionId,
      workflowId,
      userId: session.user.id,
    },
    select: {
      id: true,
      status: true,
      nodeStates: true,
      updatedAt: true,
    },
  })
  if (!execution) throw new ApiError('NOT_FOUND', { message: 'Execution not found' })

  if (execution.status === 'completed' || execution.status === 'failed') {
    return conflictResponse('execution_closed', 'Execution is already closed and cannot be resumed.')
  }

  const nodeStates = toNodeStates(execution.nodeStates)
  const persistedContinuation = isWorkflowContinuationMarker(nodeStates[WORKFLOW_CONTINUATION_STATE_KEY])
    ? nodeStates[WORKFLOW_CONTINUATION_STATE_KEY]
    : null
  if (!persistedContinuation) {
    return conflictResponse('continuation_missing', 'No paused continuation is available for this execution.')
  }
  if (!sameContinuation(persistedContinuation, requestedContinuation)) {
    return conflictResponse('continuation_stale', 'Continuation context is stale. Please reload workflow state.')
  }

  const existingLease = isWorkflowExecutionLease(nodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY])
    ? nodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY]
    : null
  const now = new Date()

  if (existingLease && !isWorkflowExecutionLeaseExpired(existingLease, now)) {
    if (existingLease.runToken !== persistedContinuation.runToken) {
      return conflictResponse('lease_run_mismatch', 'Execution lease belongs to a different run token.')
    }
    if (existingLease.holderClientId !== clientInstanceId) {
      return conflictResponse('lease_held', 'Another session currently owns execution continuation lease.')
    }

    return NextResponse.json({
      granted: true,
      alreadyHeld: true,
      executionId,
      continuation: persistedContinuation,
      lease: existingLease,
    })
  }

  const lease = createWorkflowExecutionLease({
    runToken: persistedContinuation.runToken,
    holderClientId: clientInstanceId,
    now,
  })
  nodeStates[WORKFLOW_EXECUTION_LEASE_STATE_KEY] = lease

  const updated = await prisma.workflowExecution.updateMany({
    where: {
      id: execution.id,
      workflowId,
      userId: session.user.id,
      updatedAt: execution.updatedAt,
    },
    data: {
      nodeStates: JSON.stringify(nodeStates),
      updatedAt: now,
    },
  })

  if (updated.count !== 1) {
    return conflictResponse('lease_race', 'Execution state changed while acquiring lease. Please retry.')
  }

  return NextResponse.json({
    granted: true,
    alreadyHeld: false,
    executionId,
    continuation: persistedContinuation,
    lease,
  })
})
