import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { NodeExecutionState } from '@/lib/workflow-engine/types'
import {
  resolveMediaUrl,
  resolveNodeOutputs,
  resolveOutputSourceTag,
  resolveParityInfo,
  resolveNodeWarnings,
} from '@/features/workflow-editor/output-panel-helpers'

function makeNode(data: Record<string, unknown>): Node {
  return {
    id: 'node_1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data,
  }
}

describe('workflow output panel helpers', () => {
  it('prefers execution outputs over store and initial outputs', () => {
    const executionState: NodeExecutionState = {
      status: 'completed',
      progress: 100,
      outputs: { result: 'from execution' },
    }
    const node = makeNode({ initialOutput: { result: 'from initial' } })

    const resolved = resolveNodeOutputs({
      node,
      executionState,
      nodeOutput: { result: 'from store' },
    })

    expect(resolved.source).toBe('execution')
    expect(resolved.outputs).toEqual({ result: 'from execution' })
  })

  it('falls back to nodeData.lastExecutionMeta parity info when output does not carry parity keys', () => {
    const node = makeNode({
      lastExecutionMeta: {
        temporaryImplementation: true,
        parityNotes: 'Near parity bridge',
        metadata: { model: 'gpt-4.1' },
      },
    })

    const parity = resolveParityInfo({
      node,
      outputs: { result: 'ok' },
    })

    expect(parity.temporaryImplementation).toBe(true)
    expect(parity.parityNotes).toBe('Near parity bridge')
    expect(parity.metadata).toEqual({ model: 'gpt-4.1' })
  })

  it('merges warning arrays from outputs and _metadata payload', () => {
    const warnings = resolveNodeWarnings({
      warnings: ['A', 'B'],
      _metadata: { warnings: ['B', 'C'] },
    })

    expect(warnings).toEqual(['A', 'B', 'C'])
  })

  it('marks store output as cached when execution state indicates skipped', () => {
    const sourceTag = resolveOutputSourceTag({
      executionState: {
        status: 'skipped',
        progress: 100,
        message: 'Resumed from cache',
      },
      source: 'store',
    })

    expect(sourceTag).toBe('cached')
  })

  it('normalizes relative media paths to /api/media URLs for output preview', () => {
    expect(resolveMediaUrl('images/panel-1.jpg')).toBe('/api/media/images/panel-1.jpg')
    expect(resolveMediaUrl('/images/panel-2.jpg')).toBe('/api/media/images/panel-2.jpg')
    expect(resolveMediaUrl('/api/media/images/panel-3.jpg')).toBe('/api/media/images/panel-3.jpg')
    expect(resolveMediaUrl('https://cdn.example.com/panel-4.jpg')).toBe('https://cdn.example.com/panel-4.jpg')
  })
})
