import type { NodeExecutor } from './types'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const executeReferenceImage: NodeExecutor = async (ctx) => {
  const imageUrl = readString(ctx.config.imageUrl)
  if (!imageUrl) {
    throw new Error('Reference image URL is required.')
  }

  return {
    outputs: {
      image: imageUrl,
    },
    message: 'Reference image ready.',
  }
}
