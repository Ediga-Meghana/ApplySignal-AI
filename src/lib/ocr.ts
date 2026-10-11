type OcrWorker = { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> }
type TesseractApi = { createWorker: (language: string) => Promise<OcrWorker> }
declare global { interface Window { Tesseract?: TesseractApi } }
const SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js'
let loading: Promise<TesseractApi> | null = null
async function engine(): Promise<TesseractApi> {
  if (window.Tesseract) return window.Tesseract
  if (!loading) loading = new Promise<TesseractApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`)
    const script = existing ?? document.createElement('script')
    const ok = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine did not initialize.'))
    script.addEventListener('load', ok, { once: true }); script.addEventListener('error', () => reject(new Error('Could not download the OCR engine. Check your internet connection.')), { once: true })
    if (!existing) { script.src = SCRIPT; script.async = true; script.crossOrigin = 'anonymous'; document.head.appendChild(script) }
    if (window.Tesseract) resolve(window.Tesseract)
  }).catch(e => { loading = null; throw e })
  return loading
}
/** OCR is performed in the browser. The PDF itself is never sent to the OCR CDN or an API. */
export async function ocrPdfDocument(doc: { numPages: number; getPage: (n: number) => Promise<any> }): Promise<string> {
  const api = await engine(); const worker = await api.createWorker('eng'); const output: string[] = []
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 5); i++) {
      const page = await doc.getPage(i); const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable for OCR.')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      const result = await worker.recognize(canvas); if (result.data.text.trim()) output.push(result.data.text.trim())
      canvas.width = 0; canvas.height = 0
    }
  } finally { await worker.terminate() }
  return output.join('\n\n')
}
