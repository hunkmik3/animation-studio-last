import { NextRequest, NextResponse } from 'next/server'
import type { Edge, Node } from '@xyflow/react'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (request: NextRequest) => {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const searchParams = request.nextUrl.searchParams
    const projectId = searchParams.get('projectId')
    if (!projectId) {
        throw new ApiError('INVALID_PARAMS', { message: 'Missing projectId' })
    }

    // Attempt to verify project belongs to user
    const project = await prisma.project.findFirst({
        where: { id: projectId, userId: session.user.id },
        include: {
            novelPromotionData: {
                include: {
                    characters: {
                        orderBy: { createdAt: 'asc' },
                        include: {
                            appearances: {
                                orderBy: { appearanceIndex: 'asc' },
                                take: 3,
                            }
                        }
                    },
                    locations: {
                        orderBy: { createdAt: 'asc' },
                        include: { selectedImage: true }
                    },
                    episodes: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        include: {
                            clips: {
                                orderBy: { createdAt: 'asc' },
                                include: {
                                    storyboard: {
                                        include: {
                                            panels: {
                                                orderBy: { panelIndex: 'asc' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    if (!project || !project.novelPromotionData) {
        throw new ApiError('NOT_FOUND', { message: 'Project not found' })
    }

    const latestEpisode = project.novelPromotionData.episodes[0]
    if (!latestEpisode) {
        throw new ApiError('NOT_FOUND', { message: 'No episodes found in project' })
    }

    const nodes: Node[] = []
    const edges: Edge[] = []

    const novelProj = project.novelPromotionData
    const storyId = 'story_root'
    const characters = novelProj.characters || []
    const locations = novelProj.locations || []

    // 1. Root Story Node
    nodes.push({
        id: storyId,
        type: 'workflowNode',
        position: { x: -250, y: 0 }, // Will center vertically later
        data: {
            nodeType: 'text-input',
            label: `Episode: ${latestEpisode.name || 'Story'}`,
            config: { content: latestEpisode.novelText || project.description || 'Story Content' },
            isRootStory: true
        }
    })

    // 2. Characters node (if characters exist in project)
    if (characters.length > 0) {
        const charData = characters.map((c) => {
            // Parse profileData JSON if available
            let profileInfo: Record<string, unknown> = {}
            try { if (c.profileData) profileInfo = JSON.parse(c.profileData) } catch { /**/ }
            const latestAppearance = c.appearances?.[0]
            return {
                id: c.id,
                name: c.name,
                description: profileInfo.description || profileInfo.intro || c.introduction || '',
                appearance: latestAppearance?.description || profileInfo.appearance || '',
                imageUrl: latestAppearance?.imageUrl || '',
                appearanceId: latestAppearance?.id || '',
                voiceId: c.voiceId || '',
            }
        })
        nodes.push({
            id: 'project_characters',
            type: 'workflowNode',
            position: { x: -250, y: -280 },
            data: {
                nodeType: 'text-input',
                label: `👥 Characters (${characters.length})`,
                config: { content: JSON.stringify(charData.map(c => ({ name: c.name, description: c.description, appearance: c.appearance })), null, 2) },
                isCharacterSummary: true,
                characterImages: charData.filter(c => c.imageUrl).map(c => ({ name: c.name, imageUrl: c.imageUrl })),
                initialOutput: { characters: charData }
            }
        })
    }

    // 3. Locations node (if locations exist in project)
    if (locations.length > 0) {
        const locData = locations.map((l) => ({
            id: l.id,
            name: l.name,
            description: l.summary || '',
            imageUrl: l.selectedImage?.imageUrl || '',
        }))
        nodes.push({
            id: 'project_locations',
            type: 'workflowNode',
            position: { x: -250, y: 280 },
            data: {
                nodeType: 'text-input',
                label: `📍 Locations (${locations.length})`,
                config: { content: JSON.stringify(locData.map(l => ({ name: l.name, description: l.description })), null, 2) },
                isLocationSummary: true,
                locationImages: locData.filter(l => l.imageUrl).map(l => ({ name: l.name, imageUrl: l.imageUrl })),
                initialOutput: { scenes: locData }
            }
        })
    }

    let currentGlobalY = 50

    // 2. Loop clips
    for (const [clipIndex, clip] of latestEpisode.clips.entries()) {
        const clipId = `clip_${clip.id}`
        const groupId = `group_${clip.id}`

        const hasPanels = clip.storyboard && clip.storyboard.panels && clip.storyboard.panels.length > 0
        const panels = hasPanels ? clip.storyboard!.panels : []
        const panelCount = panels.length

        // Determine group dimensions
        const groupHeight = hasPanels ? Math.max(250, panelCount * 250 + 60) : 250
        const groupWidth = 1000

        // Create Group Node (Box container)
        nodes.push({
            id: groupId,
            type: 'workflowGroup',
            position: { x: 400, y: currentGlobalY },
            data: {
                label: `🎬 Part ${clipIndex + 1} Workflow`,
                width: groupWidth,
                height: groupHeight,
                isCollapsed: false
            },
            style: {
                backgroundColor: 'rgba(30, 41, 59, 0.4)',
                border: '1px dashed #64748b',
                borderRadius: '16px',
                width: groupWidth,
                height: groupHeight,
                zIndex: -1
            }
        })

        // Clip Script Node (outside left of group)
        nodes.push({
            id: clipId,
            type: 'workflowNode',
            position: { x: 50, y: currentGlobalY + groupHeight / 2 - 50 },
            data: {
                nodeType: 'text-input',
                label: `🎬 Part ${clipIndex + 1} Script`,
                config: { content: clip.content || clip.summary || '' },
                tiedToGroup: groupId
            }
        })

        edges.push({
            id: `edge_story_${clipId}`,
            source: storyId,
            sourceHandle: 'text',
            target: clipId,
            targetHandle: 'text',
            animated: true,
            style: { strokeWidth: 2 }
        })

        if (hasPanels) {
            let localY = 40
            for (const panel of panels) {
                const imgPromptId = `imgPrompt_${panel.id}`
                const vidPromptId = `vidPrompt_${panel.id}`
                const imageGenId = `img_${panel.id}`
                const videoGenId = `vid_${panel.id}`

                // Panel Image Prompt
                nodes.push({
                    id: imgPromptId,
                    parentId: groupId,
                    extent: 'parent',
                    type: 'workflowNode',
                    position: { x: 40, y: localY },
                    data: {
                        nodeType: 'text-input',
                        label: `📝 Panel ${panel.panelIndex + 1} Image Prompt`,
                        config: { content: panel.imagePrompt || panel.description || 'Panel image prompt' },
                        panelId: panel.id,
                        workspaceBinding: 'panel-image-prompt',
                    }
                })

                // Panel Video Prompt
                nodes.push({
                    id: vidPromptId,
                    parentId: groupId,
                    extent: 'parent',
                    type: 'workflowNode',
                    position: { x: 40, y: localY + 115 },
                    data: {
                        nodeType: 'text-input',
                        label: `📝 Panel ${panel.panelIndex + 1} Video Prompt`,
                        config: { content: panel.videoPrompt || panel.description || 'Panel video prompt' },
                        panelId: panel.id,
                        workspaceBinding: 'panel-video-prompt',
                    }
                })

                // Image Generate
                nodes.push({
                    id: imageGenId,
                    parentId: groupId,
                    extent: 'parent',
                    type: 'workflowNode',
                    position: { x: 360, y: localY - 30 },
                    data: {
                        nodeType: 'image-generate',
                        label: `🖼️ Gen Image`,
                        config: {
                            provider: 'flux',
                            model: novelProj.imageModel || '',
                            aspectRatio: novelProj.videoRatio || '16:9',
                            resolution: novelProj.imageResolution || '2K'
                        },
                        panelId: panel.id,
                        workspaceBinding: 'panel-image-generate',
                        initialOutput: panel.imageUrl ? { image: panel.imageUrl } : null
                    }
                })

                // Video Generate
                nodes.push({
                    id: videoGenId,
                    parentId: groupId,
                    extent: 'parent',
                    type: 'workflowNode',
                    position: { x: 680, y: localY + 20 },
                    data: {
                        nodeType: 'video-generate',
                        label: `🎥 Gen Video`,
                        config: {
                            provider: 'kling',
                            model: novelProj.videoModel || '',
                            duration: 5,
                            aspectRatio: novelProj.videoRatio || '16:9'
                        },
                        panelId: panel.id,
                        workspaceBinding: 'panel-video-generate',
                        initialOutput: panel.videoUrl ? { video: panel.videoUrl } : null
                    }
                })

                edges.push({
                    id: `edge_${clipId}_${imgPromptId}`,
                    source: clipId,
                    sourceHandle: 'text',
                    target: imgPromptId,
                    targetHandle: 'text',
                    animated: true,
                    style: { strokeWidth: 2, stroke: '#6366f1' }
                })

                edges.push({
                    id: `edge_${imgPromptId}_${imageGenId}`,
                    source: imgPromptId,
                    sourceHandle: 'text',
                    target: imageGenId,
                    targetHandle: 'prompt',
                    animated: true,
                    style: { strokeWidth: 2, stroke: '#ec4899' }
                })

                edges.push({
                    id: `edge_${vidPromptId}_${videoGenId}`,
                    source: vidPromptId,
                    sourceHandle: 'text',
                    target: videoGenId,
                    targetHandle: 'prompt',
                    animated: true,
                    style: { strokeWidth: 2, stroke: '#ef4444' }
                })

                edges.push({
                    id: `edge_${imageGenId}_${videoGenId}`,
                    source: imageGenId,
                    sourceHandle: 'image',
                    target: videoGenId,
                    targetHandle: 'image',
                    animated: true,
                    style: { strokeWidth: 2, stroke: '#3b82f6' }
                })

                localY += 250
            }
        } else {
            // No panels -> Show Storyboard Gen node inside group
            const sbGenId = `sbGen_${clip.id}`
            nodes.push({
                id: sbGenId,
                parentId: groupId,
                extent: 'parent',
                type: 'workflowNode',
                position: { x: 40, y: 40 },
                data: {
                    nodeType: 'storyboard',
                    label: `📑 Generate Storyboard`,
                    config: {
                        prompt: 'Script: {input}',
                        panelCount: 4,
                        style: novelProj.artStyle || 'anime'
                    }
                }
            })

            edges.push({
                id: `edge_${clipId}_${sbGenId}`,
                source: clipId,
                sourceHandle: 'text',
                target: sbGenId,
                targetHandle: 'text',
                animated: true,
                style: { strokeWidth: 2, stroke: '#6366f1' }
            })
        }

        currentGlobalY += groupHeight + 60 // spacing between groups
    }

    if (nodes.length <= 1) {
        // Fallback if no specific data generated
        nodes.push({
            id: 'n1',
            type: 'workflowNode',
            position: { x: 100, y: 100 },
            data: {
                nodeType: 'text-input',
                label: 'Project Summary',
                config: { content: project.description || 'Empty Project' }
            }
        })
    } else {
        // Center the Root Story Node relative to all content
        const rootNode = nodes.find(n => n.id === storyId)
        if (rootNode) {
            rootNode.position.y = (currentGlobalY / 2) - 100
        }
    }

    return NextResponse.json({
        graphData: { nodes, edges },
        projectName: project.name
    })
})
