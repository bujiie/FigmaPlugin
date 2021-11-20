interface Slide {
    x: number
    y: number
    width: number
    height: number
    bytes: Uint8Array
}

interface Vect2 {
    _1: number
    _2: number
}

function newVect2(_1: number, _2: number): Vect2 {
    return { _1, _2 }
}

function sortPriorityY(nodeA: SceneNode, nodeB: SceneNode): number {
    const [Ax, Ay, Bx, By] = [nodeA.x, nodeA.y, nodeB.x, nodeB.y]
    return (Ay == By) ? Ax - Bx : Ay - By
}

function sortPriorityX(nodeA: SceneNode, nodeB: SceneNode): number {
    const [Ax, Ay, Bx, By] = [nodeA.x, nodeA.y, nodeB.x, nodeB.y]
    return (Ax == Bx) ? Ay - By : Ax - Bx
}

async function convertFrameNodeToImage(node: FrameNode): Promise<Uint8Array> {
    const nodeBytes: Uint8Array = await node.exportAsync()

    figma.showUI(__html__, { visible: false })
    figma.ui.postMessage(nodeBytes)

    return await new Promise((resolve, _) => {
        figma.ui.onmessage = b => resolve(b as Uint8Array)
    })
}

async function convertFrameNodeToSlide(node: FrameNode): Promise<Slide> {
    const imageBytes: Uint8Array = await convertFrameNodeToImage(node)
    return {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        bytes: imageBytes
    }
}

function newFrame(name: string, pos: Vect2, dim: Vect2): FrameNode {
    const frame = figma.createFrame()
    frame.name = name
    frame.clipsContent = true
    frame.x = pos._1
    frame.y = pos._2
    frame.resize(dim._1, dim._2)
    return frame
}

function newImage(name: string, pos: Vect2, dim: Vect2, imageBytes: Uint8Array): RectangleNode {
    const image = figma.createRectangle()
    image.name = name
    image.x = pos._1
    image.y = pos._2
    image.resize(dim._1, dim._2)
    image.fills = [{
        type: 'IMAGE',
        scaleMode: 'CROP',
        imageHash: figma.createImage(imageBytes).hash
    }]
    return image
}

(async function () {
    // We will only act on FrameNodes that are direct children to the
    // current page.
    const frameNodes: Array<FrameNode> = figma.currentPage.children
        .filter(node => node.type == 'FRAME')
        .sort(sortPriorityY) as Array<FrameNode>

    // If one of the conversions fail, the Promise.all will discontinue
    // waiting for the remainder.
    const slides: Array<Slide> = Array()
    for (const node of frameNodes) {
        slides.push(await convertFrameNodeToSlide(node))
    }

    // To keep everything separate, we will add the rasterized FrameNode
    // images to a new, more disposable page.
    const newPage = figma.createPage()
    // IMPORTANT: We must make the page we just created the current
    // page so that we can connection Reactions later. If we do not,
    // the Reactions will not be able to find the nodes referenced in
    // the Reactions.
    figma.currentPage = newPage

    for (const i of Array(slides.length).keys()) {
        // we need a new frame for each slide. 
        const { x, y, width, height } = slides[i]
        const frame = newFrame(`frame ${i}`, newVect2(x, y), newVect2(width, height))

        // for each frame, we need variations of the next (1), current (0), and
        // previous (-1) slide in that order.
        for (const di of [1, 0, -1]) {
            const index = i + di
            // the first slide does not have a previous slide that needs to be
            // included and the last slide does not have a next slide that needs
            // to be included.
            if (index < 0 || index >= slides.length) {
                continue
            }

            const { width, height, bytes } = slides[index]
            const [x, y] = [0, 0]

            let [adjustedX, adjustedWidth] = [x, width]
            // If we're working with the previous slide, we need to squish it
            // horizontally to make the transition look like a squeeze effect.
            if (di < 0) {
                adjustedWidth = adjustedWidth / 12
                adjustedX = -(adjustedWidth + 20)
            }
            const image = newImage(`rect ${index}`, newVect2(adjustedX, y), newVect2(adjustedWidth, height), bytes)
            frame.appendChild(image)
        }
    }

    // Get all the FrameNodes from our new page. We will only connect
    // FrameNodes to each other with Reactions.
    const newFrames = newPage.children
        .filter(node => node.type == 'FRAME') as Array<FrameNode>

    // We only need to loop up to len - 1 because the last node will
    // not have any following nodes to connect to. len - 1 also ensures
    // use that we always have a "next".
    for (let i = 0; i < newFrames.length - 1; i++) {
        const currFrame = newFrames[i]
        const nextFrame = newFrames[i + 1]

        if (i == 0) {
            newPage.flowStartingPoints = [{
                nodeId: currFrame.id,
                name: "Start Slideshow"
            }]
        }
        currFrame.reactions = [{
            action: {
                type: "NODE",
                destinationId: nextFrame.id,
                navigation: "NAVIGATE",
                preserveScrollPosition: false,
                transition: {
                    type: "SMART_ANIMATE",
                    easing: {
                        type: "EASE_OUT"
                    },
                    duration: 1
                }
            },
            trigger: {
                type: "ON_CLICK"
            }
        }]
    }
})().then(() => figma.closePlugin())