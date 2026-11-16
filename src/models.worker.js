import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import { paintStroke } from './mask.js'

env.wasm.wasmPaths = {
  wasm: new URL(wasmUrl, self.location.href).href,
  mjs: new URL(wasmModuleUrl, self.location.href).href,
}
env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1
env.wasm.proxy = false
env.logLevel = 'warning'

let activeModel
let activeSession

function progress(text, fraction) {
  self.postMessage({ type: 'progress', text, fraction })
}

async function loadModel({ mode, url, size }) {
  if (activeModel === mode) return activeSession
  if (new URL(url).origin !== self.location.origin) throw new Error('Model files must come from Image QA.')
  if (activeSession) {
    await activeSession.release()
    activeModel = undefined
    activeSession = undefined
  }

  progress('Loading model…', 0)
  const response = await fetch(url, { credentials: 'omit', redirect: 'error' })
  if (!response.ok || !response.body) {
    throw new Error('Could not load the model file. Check the app connection and try again.')
  }

  let offset = 0
  const bytes = new Uint8Array(size)
  const reader = response.body.getReader()
  try {
    while (offset < size) {
      const { value, done } = await reader.read()
      if (done) break
      if (offset + value.length > size) throw new Error('The model file has an unexpected size.')
      bytes.set(value, offset)
      offset += value.length
      progress('Loading model…', offset / size)
    }
    if (offset !== size) throw new Error('The model file is incomplete. Try again.')
    if (!(await reader.read()).done) throw new Error('The model file has an unexpected size.')
  } finally {
    await reader.cancel()
  }

  progress('Starting local model…')
  activeSession = await InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  activeModel = mode
  return activeSession
}

function canvas(width, height, read = false) {
  const surface = new OffscreenCanvas(width, height)
  const context = surface.getContext('2d', { willReadFrequently: read })
  if (!context) throw new Error('Could not create a canvas for this image.')
  context.imageSmoothingQuality = 'high'
  return context
}

function normalizeMask(values, width, height) {
  let low = Infinity
  let high = -Infinity
  for (const value of values) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    throw new Error('The model could not estimate a background for this image.')
  }

  const context = canvas(width, height)
  const matte = context.createImageData(width, height)
  const spread = high - low
  for (let index = 0; index < values.length; index += 1) {
    const opacity = spread > 0.00001 ? (values[index] - low) / spread : values[index]
    matte.data[index * 4 + 3] = opacity * 255
  }
  context.putImageData(matte, 0, 0)
  return context.canvas
}

async function removeBackground(session, bitmap) {
  const size = 320
  const planeSize = size * size
  const inputContext = canvas(size, size, true)
  inputContext.drawImage(bitmap, 0, 0, size, size)
  const { data } = inputContext.getImageData(0, 0, size, size)
  const input = new Float32Array(planeSize * 3)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  let peak = 1
  for (let index = 0; index < data.length; index += 4) {
    peak = Math.max(peak, data[index], data[index + 1], data[index + 2])
  }
  for (let channel = 0; channel < 3; channel += 1) {
    for (let index = 0; index < planeSize; index += 1) {
      input[channel * planeSize + index] = (data[index * 4 + channel] / peak - mean[channel]) / std[channel]
    }
  }

  const name = session.outputNames[0]
  const output = await session.run({ [session.inputNames[0]]: new Tensor('float32', input, [1, 3, size, size]) }, [name])
  const matte = normalizeMask(output[name].data, size, size)
  const result = canvas(bitmap.width, bitmap.height)
  result.drawImage(bitmap, 0, 0)
  result.globalCompositeOperation = 'destination-in'
  result.drawImage(matte, 0, 0, bitmap.width, bitmap.height)
  return result.canvas.convertToBlob({ type: 'image/png' })
}

function maskCrop(strokes, imageWidth, imageHeight) {
  let left = imageWidth
  let top = imageHeight
  let right = 0
  let bottom = 0
  for (const { diameter, points } of strokes) {
    const radius = diameter / 2
    for (const { x, y } of points) {
      left = Math.min(left, x - radius)
      top = Math.min(top, y - radius)
      right = Math.max(right, x + radius)
      bottom = Math.max(bottom, y + radius)
    }
  }

  left = Math.max(0, left)
  top = Math.max(0, top)
  right = Math.min(imageWidth, right)
  bottom = Math.min(imageHeight, bottom)
  const extent = Math.max(right - left, bottom - top)
  const size = Math.ceil(Math.max(384, extent * 1.5))
  const width = Math.min(size, imageWidth)
  const height = Math.min(size, imageHeight)
  const x = Math.max(0, Math.min(imageWidth - width, Math.floor((left + right - width) / 2)))
  const y = Math.max(0, Math.min(imageHeight - height, Math.floor((top + bottom - height) / 2)))
  return { x, y, width, height }
}

function drawMask(context, strokes, region, width, height) {
  context.save()
  context.scale(width / region.width, height / region.height)
  context.translate(-region.x, -region.y)
  context.fillStyle = '#fff'
  context.strokeStyle = '#fff'
  for (const stroke of strokes) paintStroke(context, stroke)
  context.restore()
}

function padEdges(context, width, height, size) {
  const surface = context.canvas
  if (width < size) context.drawImage(surface, width - 1, 0, 1, height, width, 0, size - width, height)
  if (height < size) context.drawImage(surface, 0, height - 1, size, 1, 0, height, size, size - height)
}

async function removeWatermark(session, bitmap, strokes) {
  const size = 512
  const planeSize = size * size
  const region = maskCrop(strokes, bitmap.width, bitmap.height)
  const scale = size / Math.max(region.width, region.height)
  const width = Math.max(1, Math.round(region.width * scale))
  const height = Math.max(1, Math.round(region.height * scale))

  const crop = canvas(size, size, true)
  crop.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, width, height)
  padEdges(crop, width, height, size)
  const image = crop.getImageData(0, 0, size, size).data
  const mask = canvas(size, size, true)
  drawMask(mask, strokes, region, width, height)
  padEdges(mask, width, height, size)
  const selection = mask.getImageData(0, 0, size, size).data
  const input = new Float32Array(4 * planeSize)
  for (let index = 0; index < planeSize; index += 1) {
    if (selection[index * 4 + 3]) {
      input[3 * planeSize + index] = 1
    } else {
      input[index] = image[index * 4] / 255
      input[planeSize + index] = image[index * 4 + 1] / 255
      input[2 * planeSize + index] = image[index * 4 + 2] / 255
    }
  }

  const output = await session.run({ input: new Tensor('float32', input, [1, 4, size, size]) })
  const pixels = output.output.data
  const fill = crop.createImageData(size, size)
  for (let index = 0; index < planeSize; index += 1) {
    fill.data[index * 4] = pixels[index] * 255
    fill.data[index * 4 + 1] = pixels[planeSize + index] * 255
    fill.data[index * 4 + 2] = pixels[2 * planeSize + index] * 255
    fill.data[index * 4 + 3] = 255
  }
  crop.putImageData(fill, 0, 0)

  const patch = canvas(region.width, region.height)
  patch.drawImage(crop.canvas, 0, 0, width, height, 0, 0, region.width, region.height)
  const fullMask = canvas(region.width, region.height)
  drawMask(fullMask, strokes, region, region.width, region.height)
  patch.globalCompositeOperation = 'destination-in'
  patch.drawImage(fullMask.canvas, 0, 0)
  const result = canvas(bitmap.width, bitmap.height)
  result.drawImage(bitmap, 0, 0)
  result.globalCompositeOperation = 'source-atop'
  result.drawImage(patch.canvas, region.x, region.y)
  return result.canvas.convertToBlob({ type: 'image/png' })
}

self.addEventListener('message', async ({ data: { model, bitmap, strokes } }) => {
  try {
    const session = await loadModel(model)
    progress(model.mode === 'watermark' ? 'Removing watermark…' : 'Removing background…')
    const blob = model.mode === 'watermark'
      ? await removeWatermark(session, bitmap, strokes)
      : await removeBackground(session, bitmap)
    self.postMessage({ type: 'result', blob })
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'The local model could not finish this edit.' })
  } finally {
    bitmap.close()
  }
})
