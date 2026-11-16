import '@fontsource-variable/dm-sans'
import './style.css'
import { paintStroke } from './mask.js'

const icons = import.meta.glob('/node_modules/lucide-static/icons/{arrow-up-right,download,eraser,folder-open,hand,image-up,lock-keyhole,plus,rotate-ccw,scan-face,scan-line,shield-check,sparkles,undo-2,x,zoom-in,zoom-out}.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
})
for (const element of document.querySelectorAll('[data-icon]')) {
  element.innerHTML = icons[`/node_modules/lucide-static/icons/${element.dataset.icon}.svg`]
  element.setAttribute('aria-hidden', 'true')
}

const byId = (id) => document.getElementById(id)
const ui = Object.fromEntries([
  'open', 'choose', 'file', 'filename', 'sample', 'original', 'result', 'download',
  'stage', 'empty', 'image-viewport', 'image-stack', 'preview', 'overlay', 'brush-cursor',
  'zoom-controls', 'zoom-out', 'zoom-in', 'zoom-fit', 'zoom-value', 'pan',
  'watermark-tool', 'background-tool', 'options-title', 'instructions', 'brush-options',
  'brush', 'brush-value', 'undo', 'clear', 'run', 'run-label', 'setup-hint',
  'busy', 'progress', 'progress-text', 'status', 'reset', 'privacy', 'privacy-dialog',
].map((id) => [id, byId(id)]))

const asset = (file) => new URL(import.meta.env.BASE_URL + file, window.location.href).href
const profiles = {
  watermark: {
    title: 'Watermark brush',
    instructions: 'Paint over the watermark, then run the tool to fill the area.',
    action: 'Remove watermark',
    setup: 'LaMa model · 62 MB on first use',
    file: 'lama_512_int8.onnx',
    size: 62074990,
  },
  background: {
    title: 'Background removal',
    instructions: 'Detect the main subject and make the background transparent.',
    action: 'Remove background',
    setup: 'U²-Net model · 4.6 MB on first use',
    file: 'u2netp.onnx',
    size: 4574861,
  },
}

let mode = 'watermark'
let image
let result
let viewingOriginal = false
let busy = false
let worker
let strokes = []
let pointerId
let pointerStroke
let cursorPoint
let overlayFrame
const zoomLevels = [1, 1.5, 2, 3, 4]
let zoomIndex = 0
let panMode = false
let panDrag
const viewport = ui['image-viewport']
const context = ui.overlay.getContext('2d')

function status(message, error = false) {
  ui.status.textContent = message
  ui.status.dataset.error = String(error)
}

function redrawMask() {
  overlayFrame = undefined
  context.clearRect(0, 0, ui.overlay.width, ui.overlay.height)
  if (!image) return

  context.save()
  context.scale(ui.overlay.width / image.width, ui.overlay.height / image.height)
  context.fillStyle = '#7850ff'
  context.strokeStyle = '#7850ff'
  for (const stroke of strokes) paintStroke(context, stroke)
  context.restore()
}

function scheduleMask() {
  if (overlayFrame === undefined) overlayFrame = requestAnimationFrame(redrawMask)
}

function render() {
  const profile = profiles[mode]
  const visibleImage = viewingOriginal ? image : result ?? image
  const brushVisible = Boolean(image) && mode === 'watermark' && !viewingOriginal
  const brushEnabled = brushVisible && !busy
  const canPaint = brushEnabled && !panMode
  const canZoom = Boolean(image) && !busy
  const zoomed = zoomIndex > 0
  const canPan = canZoom && zoomed
  ui.empty.hidden = Boolean(image)
  viewport.hidden = !image
  ui.filename.hidden = !image
  ui['zoom-controls'].hidden = !image
  viewport.style.setProperty('--zoom', zoomLevels[zoomIndex])
  viewport.classList.toggle('zoomed', zoomed)
  viewport.classList.toggle('pan-mode', canPan && panMode)
  const zoomValue = `${zoomLevels[zoomIndex] * 100}%`
  if (ui['zoom-value'].value !== zoomValue) ui['zoom-value'].value = zoomValue
  ui['zoom-out'].disabled = !canPan
  ui['zoom-fit'].disabled = !canPan
  ui['zoom-in'].disabled = !canZoom || zoomIndex === zoomLevels.length - 1
  ui.pan.disabled = !canPan
  ui.pan.setAttribute('aria-pressed', String(panMode))
  if (panDrag && (!canPan || !panMode)) {
    viewport.releasePointerCapture(panDrag.pointerId)
    panDrag = undefined
  }

  if (image) {
    if (ui.preview.getAttribute('src') !== visibleImage.url) ui.preview.src = visibleImage.url
    ui.filename.textContent = image.name
    ui.filename.title = image.name
    viewport.style.setProperty('--ratio', image.width / image.height)
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    if (ui.overlay.width !== width || ui.overlay.height !== height) {
      ui.overlay.width = width
      ui.overlay.height = height
    }
  }
  ui.overlay.hidden = !brushVisible
  ui.overlay.tabIndex = canPaint ? 0 : -1
  if (!canPaint) {
    if (pointerId !== undefined) ui.overlay.releasePointerCapture(pointerId)
    pointerId = undefined
    pointerStroke = undefined
    hideCursor()
  }
  ui['watermark-tool'].setAttribute('aria-pressed', String(mode === 'watermark'))
  ui['background-tool'].setAttribute('aria-pressed', String(mode === 'background'))
  ui['options-title'].textContent = profile.title
  ui.instructions.textContent = profile.instructions
  ui['brush-options'].hidden = mode !== 'watermark'
  ui['brush-value'].textContent = `${ui.brush.value} px`
  ui['run-label'].textContent = profile.action
  ui['setup-hint'].textContent = profile.setup
  ui.original.disabled = !result || busy
  ui.result.disabled = !result || busy
  ui.original.setAttribute('aria-pressed', String(!result || viewingOriginal))
  ui.result.setAttribute('aria-pressed', String(Boolean(result) && !viewingOriginal))
  ui.download.disabled = !result || busy
  ui.reset.hidden = !result
  ui.reset.disabled = busy
  ui.brush.disabled = !brushEnabled
  ui.undo.disabled = !brushEnabled || !strokes.length
  ui.clear.disabled = ui.undo.disabled
  ui.run.disabled = busy || !image || (mode === 'watermark' && (!strokes.length || viewingOriginal))
  for (const id of ['open', 'choose', 'sample', 'watermark-tool', 'background-tool']) {
    ui[id].disabled = busy
  }
  ui.busy.hidden = !busy
  ui.stage.setAttribute('aria-busy', String(busy))
  scheduleMask()
}

function updateProgress(text, fraction) {
  ui['progress-text'].textContent = text
  ui.progress.hidden = !Number.isFinite(fraction)
  if (!ui.progress.hidden) ui.progress.value = fraction
}

function imageDetails() {
  return `${image.width.toLocaleString()} × ${image.height.toLocaleString()} px`
}

async function verifyFormat(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const startsWith = (signature, at = 0) => signature.every((byte, index) => bytes[at + index] === byte)
  if (!startsWith([255, 216, 255])
    && !startsWith([137, 80, 78, 71, 13, 10, 26, 10])
    && !(startsWith([82, 73, 70, 70]) && startsWith([87, 69, 66, 80], 8))) {
    throw new Error('Choose a JPG, PNG, or WebP image.')
  }
}

async function openImage(file, useSample = false) {
  if (busy || (!file && !useSample)) return
  busy = true
  updateProgress('Opening image…')
  render()

  let bitmap
  try {
    let blob = file
    if (useSample) {
      const response = await fetch(asset('assets/balloon.jpg'))
      if (!response.ok) throw new Error('Could not open the sample image.')
      blob = await response.blob()
    } else {
      if (file.size > 30 * 1024 * 1024) throw new Error('Choose an image under 30 MB.')
      await verifyFormat(file)
    }

    try {
      bitmap = await createImageBitmap(blob)
    } catch {
      throw new Error('This image could not be decoded. Try a different file.')
    }
    const { width, height } = bitmap
    if (width * height > 24_000_000 || Math.max(width, height) > 12_000) {
      throw new Error('Choose an image up to 24 megapixels and 12,000 pixels per side.')
    }

    if (useSample) {
      const sample = document.createElement('canvas')
      sample.width = width
      sample.height = height
      const painter = sample.getContext('2d')
      painter.drawImage(bitmap, 0, 0)
      painter.font = 'bold 30px system-ui'
      painter.textAlign = 'right'
      painter.fillStyle = '#fffffff0'
      painter.fillText('SAMPLE', width * 0.94, height * 0.81)
      blob = await new Promise((resolve) => sample.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not prepare the sample image.')
    }

    const url = URL.createObjectURL(blob)
    if (image) URL.revokeObjectURL(image.url)
    if (result) URL.revokeObjectURL(result.url)
    image = { blob, name: useSample ? 'Hot air balloon.png' : file.name, url, width, height }
    result = undefined
    strokes = []
    viewingOriginal = false
    zoomIndex = 0
    panMode = false
    status(imageDetails())
  } catch (error) {
    status(error.message, true)
  } finally {
    bitmap?.close()
    busy = false
    render()
  }
}

function selectTool(tool) {
  mode = tool
  viewingOriginal = false
  render()
}

function setResult(blob) {
  const url = URL.createObjectURL(blob)
  if (result) URL.revokeObjectURL(result.url)
  result = { blob, url }
  viewingOriginal = false
  strokes = []
  status(`Edit complete · ${imageDetails()}`)
}

function endRun(error) {
  if (error) status(error, true)
  busy = false
  render()
}

function inferenceWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./models.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      updateProgress(data.text, data.fraction)
    } else if (data.type === 'result') {
      setResult(data.blob)
      endRun()
    } else {
      endRun(data.message)
    }
  }
  worker.onerror = () => {
    worker.terminate()
    worker = undefined
    endRun('Could not start the local editor. Refresh the page or try a recent Chrome, Firefox, or Safari browser.')
  }
  return worker
}

async function runEdit() {
  if (ui.run.disabled) return
  busy = true
  viewingOriginal = false
  status(imageDetails())
  updateProgress('Preparing image…')
  render()
  let bitmap
  try {
    const profile = profiles[mode]
    const model = { mode, url: asset(`models/${profile.file}`), size: profile.size }
    bitmap = await createImageBitmap((result ?? image).blob)
    inferenceWorker().postMessage({ model, bitmap, strokes }, [bitmap])
  } catch (error) {
    bitmap?.close()
    endRun(error.message || 'Could not prepare the image.')
  }
}

function download() {
  const link = document.createElement('a')
  link.href = result.url
  const name = image.name.replace(/\.[^.]+$/, '') || 'image'
  link.download = `${name}-edited.png`
  document.body.append(link)
  link.click()
  link.remove()
}

function hideCursor() {
  cursorPoint = undefined
  ui['brush-cursor'].hidden = true
}

function showCursor(point) {
  const cursor = ui['brush-cursor']
  cursorPoint = point
  cursor.style.left = `${point.x / image.width * 100}%`
  cursor.style.top = `${point.y / image.height * 100}%`
  cursor.style.width = `${ui.brush.value}px`
  cursor.style.height = cursor.style.width
  cursor.hidden = false
}

function addStroke(point) {
  const stroke = {
    points: [point],
    diameter: Number(ui.brush.value) * image.width / ui.overlay.getBoundingClientRect().width,
  }
  strokes.push(stroke)
  render()
  return stroke
}

function pointerPosition({ clientX, clientY }) {
  const bounds = ui['image-stack'].getBoundingClientRect()
  const { left, top } = viewport.getBoundingClientRect()
  const x = Math.max(left, Math.min(left + viewport.clientWidth, clientX))
  const y = Math.max(top, Math.min(top + viewport.clientHeight, clientY))
  return {
    x: Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)) * image.width,
    y: Math.max(0, Math.min(1, (y - bounds.top) / bounds.height)) * image.height,
  }
}

function viewportCenter() {
  const { left, top } = viewport.getBoundingClientRect()
  return pointerPosition({ clientX: left + viewport.clientWidth / 2, clientY: top + viewport.clientHeight / 2 })
}

function changeZoom(index) {
  const next = Math.max(0, Math.min(zoomLevels.length - 1, index))
  if (!image || busy || next === zoomIndex || pointerId !== undefined) return
  const center = viewportCenter()
  zoomIndex = next
  if (zoomIndex === 0) panMode = false
  hideCursor()
  render()

  if (zoomIndex === 0) return
  const { left, top } = viewport.getBoundingClientRect()
  const bounds = ui['image-stack'].getBoundingClientRect()
  viewport.scrollBy(
    bounds.left - left + center.x / image.width * bounds.width - viewport.clientWidth / 2,
    bounds.top - top + center.y / image.height * bounds.height - viewport.clientHeight / 2,
  )
}

viewport.addEventListener('pointerdown', (event) => {
  if (ui.pan.disabled || !panMode || panDrag || event.button !== 0) return
  // Let scrollbar interactions use the browser's scrolling behavior.
  const { left, top } = viewport.getBoundingClientRect()
  if (event.clientX >= left + viewport.clientWidth || event.clientY >= top + viewport.clientHeight) return
  event.preventDefault()
  viewport.setPointerCapture(event.pointerId)
  panDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
  }
})
viewport.addEventListener('pointermove', (event) => {
  if (event.pointerId !== panDrag?.pointerId) return
  viewport.scrollTo(panDrag.scrollLeft + panDrag.x - event.clientX, panDrag.scrollTop + panDrag.y - event.clientY)
})
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  viewport.addEventListener(eventName, (event) => {
    if (event.pointerId === panDrag?.pointerId) panDrag = undefined
  })
}

ui.overlay.addEventListener('pointerdown', (event) => {
  if (ui.brush.disabled || panMode || pointerId !== undefined || event.button !== 0) return
  event.preventDefault()
  pointerId = event.pointerId
  ui.overlay.setPointerCapture(pointerId)
  const point = pointerPosition(event)
  showCursor(point)
  pointerStroke = addStroke(point)
})
ui.overlay.addEventListener('pointermove', (event) => {
  if (ui.brush.disabled || panMode || (pointerId !== undefined && event.pointerId !== pointerId)) return
  const point = pointerPosition(event)
  showCursor(point)
  if (event.pointerId === pointerId) {
    pointerStroke.points.push(point)
    scheduleMask()
  }
})
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  ui.overlay.addEventListener(eventName, (event) => {
    if (event.pointerId !== pointerId) return
    pointerId = undefined
    pointerStroke = undefined
    if (event.pointerType !== 'mouse') hideCursor()
  })
}
ui.overlay.addEventListener('pointerleave', () => {
  if (pointerId === undefined) hideCursor()
})
ui.overlay.addEventListener('blur', hideCursor)
ui.overlay.addEventListener('keydown', (event) => {
  if (ui.brush.disabled || panMode || pointerId !== undefined) return
  const directions = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  }
  const direction = directions[event.key]
  if (!direction && event.code !== 'Space') return
  event.preventDefault()
  const current = cursorPoint ?? viewportCenter()
  if (direction) {
    const step = (event.shiftKey ? 25 : 5) * image.width / ui.overlay.getBoundingClientRect().width
    showCursor({
      x: Math.max(0, Math.min(image.width, current.x + direction[0] * step)),
      y: Math.max(0, Math.min(image.height, current.y + direction[1] * step)),
    })
    if (zoomIndex > 0) {
      const { left, top } = viewport.getBoundingClientRect()
      const cursor = ui['brush-cursor'].getBoundingClientRect()
      viewport.scrollBy(
        Math.min(0, cursor.left - left) + Math.max(0, cursor.right - left - viewport.clientWidth),
        Math.min(0, cursor.top - top) + Math.max(0, cursor.bottom - top - viewport.clientHeight),
      )
    }
  } else {
    showCursor(current)
    addStroke(current)
  }
})

for (const eventName of ['dragover', 'drop']) {
  window.addEventListener(eventName, (event) => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  })
}
ui.stage.addEventListener('dragover', (event) => {
  if (busy || !event.dataTransfer.types.includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
  ui.stage.classList.add('dragging')
})
ui.stage.addEventListener('dragleave', (event) => {
  if (!ui.stage.contains(event.relatedTarget)) ui.stage.classList.remove('dragging')
})
ui.stage.addEventListener('drop', (event) => {
  ui.stage.classList.remove('dragging')
  openImage(event.dataTransfer.files[0])
})

ui.open.addEventListener('click', () => ui.file.click())
ui.choose.addEventListener('click', () => ui.file.click())
ui.file.addEventListener('change', () => {
  openImage(ui.file.files[0])
  ui.file.value = ''
})
ui.sample.addEventListener('click', () => openImage(null, true))
ui['zoom-out'].addEventListener('click', () => changeZoom(zoomIndex - 1))
ui['zoom-in'].addEventListener('click', () => changeZoom(zoomIndex + 1))
ui['zoom-fit'].addEventListener('click', () => changeZoom(0))
ui.pan.addEventListener('click', () => {
  panMode = !panMode
  render()
})
ui['watermark-tool'].addEventListener('click', () => selectTool('watermark'))
ui['background-tool'].addEventListener('click', () => selectTool('background'))
ui.brush.addEventListener('input', () => {
  if (cursorPoint) showCursor(cursorPoint)
  render()
})
ui.undo.addEventListener('click', () => {
  strokes.pop()
  render()
})
ui.clear.addEventListener('click', () => {
  strokes = []
  render()
})
ui.original.addEventListener('click', () => {
  viewingOriginal = true
  render()
})
ui.result.addEventListener('click', () => {
  viewingOriginal = false
  render()
})
ui.reset.addEventListener('click', () => {
  URL.revokeObjectURL(result.url)
  result = undefined
  strokes = []
  viewingOriginal = false
  status(imageDetails())
  render()
})
ui.run.addEventListener('click', runEdit)
ui.download.addEventListener('click', download)
ui.privacy.addEventListener('click', () => ui['privacy-dialog'].showModal())

render()
