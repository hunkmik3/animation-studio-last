import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

type Params = { params: Promise<{ workflowId: string }> }

/**
 * Legacy endpoint intentionally disabled.
 *
 * This route previously used a simplified server-side executor with placeholder logic.
 * The launch-safe workflow path is now the node-by-node execution bridge:
 *   POST /api/workflows/execute-node + frontend orchestration/monitoring.
 */
export const POST = apiHandler(async (_request: NextRequest, context: Params) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const { workflowId } = await context.params

  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, userId: session.user.id },
    select: { id: true },
  })
  if (!workflow) {
    throw new ApiError('NOT_FOUND')
  }

  throw new ApiError('INVALID_PARAMS', {
    message: 'Server-side /execute endpoint is disabled for launch safety. Use workflow editor run (execute-node bridge) instead.',
  })
})

