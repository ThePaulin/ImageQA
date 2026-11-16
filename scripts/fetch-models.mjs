import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const directory = new URL('../public/models/', import.meta.url)
const models = [
  {
    name: 'u2netp.onnx',
    source: 'https://huggingface.co/nfa04/u2netp-onnx/resolve/8e72726f035efc3d1918c96b020d536f2b69ba0c/u2netp.onnx',
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  },
  {
    name: 'lama_512_int8.onnx',
    source: 'https://huggingface.co/g-ronimo/lama/resolve/386a67cedf9b8bb4fe76798c10c8d77abc0a5cc8/lama_512_int8.onnx',
    sha256: 'cab19978adc306622fe37ef60d4a52103b99c98141d499c2a2366a7ed1255dbe',
  },
]

async function hasChecksum(file, expected) {
  try {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return hash.digest('hex') === expected
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function prepareModel({ name, source, sha256 }) {
  const destination = new URL(name, directory)
  if (await hasChecksum(destination, sha256)) return
  const temporary = new URL(`${name}.${randomUUID()}.part`, directory)

  try {
    console.log(`Downloading ${name}…`)
    const response = await fetch(source, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok || !response.body) {
      throw new Error(`Download returned HTTP ${response.status}`)
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
    if (!await hasChecksum(temporary, sha256)) throw new Error('SHA-256 checksum mismatch')
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

try {
  await mkdir(directory, { recursive: true })
  for (const model of models) await prepareModel(model)
} catch (error) {
  console.error('Could not prepare the model files. Check your connection and run npm run models again.')
  console.error(error.cause ?? error)
  process.exitCode = 1
}
