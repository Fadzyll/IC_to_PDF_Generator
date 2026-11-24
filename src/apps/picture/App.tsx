import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { blobToCanvas, loadImage, wipe } from '../../lib/image'
import { type FilterId } from '../../lib/filters'
import { fullQuad } from '../../lib/perspective'
import { createPage, thumbnailUrl, updatePage, type Page, type Rotation } from '../../lib/pages'
import type { Margin, PageSize, Quality } from '../../lib/pdf-pages'
import { DEFAULT_WATERMARK, type WatermarkOptions } from '../../lib/watermark'
import { Cropper, type CropResult } from '../../components/Cropper'
import { Camera } from '../../components/Camera'
import { WatermarkControls } from '../../components/WatermarkControls'
import { BusyOverlay, ErrorBox, FilterPicker, SupportNote } from '../../components/shared'
import {
  dateStamp,
  describeError,
  downloadFile,
  hasLiveCamera,
  nextFrame,
  useReleaseReplaced,
  type AppError,
} from '../../lib/app-utils'

/** More pages than this gets slow and memory-hungry on phones. */
const MAX_PAGES = 50

type Overlay =
  | { kind: 'camera' }
  | { kind: 'crop'; pageId: string; source: HTMLCanvasElement; initial: CropResult }
  | null

export default function App() {
  const [pages, setPages] = useState<Page[]>([])
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [autoCrop, setAutoCrop] = useState(true)
  const [filter, setFilter] = useState<FilterId>('enhance')
  const [pageSize, setPageSize] = useState<PageSize>('a4')
  const [margin, setMargin] = useState<Margin>('small')
  const [quality, setQuality] = useState<Quality>('balanced')
  const [fileName, setFileName] = useState('')
  const [wmOn, setWmOn] = useState(false)
  const [wm, setWm] = useState<WatermarkOptions>(DEFAULT_WATERMARK)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [done, setDone] = useState(false)
  // Photos taken in the current camera session (shown as a counter in the camera).
  const [shots, setShots] = useState(0)

  const fileRef = useRef<HTMLInputElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)
  // Camera photos are processed one after another while the camera stays open.
  const queue = useRef<Promise<void>>(Promise.resolve())
  // Latest pages, for async work that outlives a render.
  const pagesRef = useRef(pages)
  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  const watermark = wmOn ? wm : null
  const full = pages.length >= MAX_PAGES

  // Preload the PDF code once there's something to save (a redeploy can't break the download then).
  const hasPages = pages.length > 0
  useEffect(() => {
    if (hasPages) import('../../lib/pdf-pages').catch(() => {})
  }, [hasPages])

  // Lock page scroll while a full-screen overlay is open.
  useEffect(() => {
    document.body.style.overflow = overlay ? 'hidden' : ''
  }, [overlay])

  function addPage(page: Page) {
    setPages((p) => (p.length >= MAX_PAGES ? p : [...p, page]))
    setDone(false)
  }

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    // Copy now: the FileList is live and empties when the input is reset.
    const picked = Array.from(files)
    const room = MAX_PAGES - pagesRef.current.length
    const list = picked.slice(0, room)
    let failed = 0
    for (let i = 0; i < list.length; i++) {
      setBusy(list.length > 1 ? `Adding page ${i + 1} of ${list.length}…` : 'Adding page…')
      await nextFrame()
      let src: HTMLCanvasElement | null = null
      try {
        src = await loadImage(list[i])
        addPage(await createPage(src, autoCrop))
      } catch (e) {
        console.error(e)
        failed++
        // Out of memory: stop rather than fail every remaining photo.
        if ((e as Error)?.name === 'CanvasMemoryError') {
          setError(describeError(e, 'adding photos'))
          break
        }
      } finally {
        wipe(src)
      }
    }
    setBusy(null)
    if (picked.length > room) {
      setError({ message: `Only ${MAX_PAGES} pages fit in one PDF, so ${picked.length - room} photo(s) were skipped.` })
    } else if (failed) {
      setError((prev) => prev ?? { message: `${failed} photo(s) couldn't be read and were skipped.` })
    }
  }

  function onSnap() {
    setError(null)
    if (hasLiveCamera()) {
      setShots(0)
      setOverlay({ kind: 'camera' })
    } else {
      captureRef.current?.click()
    }
  }

  function onCameraCapture(frame: HTMLCanvasElement) {
    if (pagesRef.current.length + 1 > MAX_PAGES) {
      wipe(frame)
      return
    }
    setShots((n) => n + 1)
    queue.current = queue.current
      .then(async () => addPage(await createPage(frame, autoCrop)))
      .catch((e) => setError(describeError(e, 'adding a photo')))
      .finally(() => wipe(frame))
  }

  async function onCameraDone() {
    setOverlay(null)
    setBusy('Finishing pages…')
    await queue.current
    setBusy(null)
  }

  async function editCrop(page: Page) {
    setError(null)
    setBusy('Opening…')
    try {
      const source = await blobToCanvas(page.source)
      setOverlay({
        kind: 'crop',
        pageId: page.id,
        source,
        initial: { quad: page.quad ?? fullQuad(source.width, source.height), flipped: false },
      })
    } catch (e) {
      setError(describeError(e, 'opening the photo'))
    } finally {
      setBusy(null)
    }
  }

  async function onCropDone(pageId: string, source: HTMLCanvasElement, r: CropResult) {
    setOverlay(null)
    wipe(source)
    const page = pagesRef.current.find((p) => p.id === pageId)
    if (!page) return
    await changePage(page, { quad: r.quad }, 'Straightening…')
  }

  async function changePage(page: Page, changes: Parameters<typeof updatePage>[1], label: string) {
    setBusy(label)
    try {
      const next = await updatePage(page, changes)
      setPages((ps) => ps.map((p) => (p.id === page.id ? next : p)))
      setDone(false)
    } catch (e) {
      setError(describeError(e, 'updating the page'))
    } finally {
      setBusy(null)
    }
  }

  const rotate = (page: Page) => changePage(page, { rotation: ((page.rotation + 90) % 360) as Rotation }, 'Rotating…')

  function move(index: number, by: -1 | 1) {
    setPages((ps) => {
      const j = index + by
      if (j < 0 || j >= ps.length) return ps
      const next = [...ps]
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  const remove = (id: string) => setPages((ps) => ps.filter((p) => p.id !== id))

  function clearAll() {
    setPages([])
    setWm(DEFAULT_WATERMARK)
    setWmOn(false)
    setFileName('')
    setError(null)
    setDone(false)
  }

  async function makePdfFile(): Promise<File> {
    const { buildPagesPdf } = await import('../../lib/pdf-pages')
    const bytes = await buildPagesPdf(pages, { pageSize, margin, quality, filter, watermark }, (i, n) =>
      setBusy(n > 1 ? `Generating PDF… page ${Math.min(i + 1, n)} of ${n}` : 'Generating PDF…'),
    )
    const base = fileName.trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || `Scan-${dateStamp()}`
    return new File([bytes as BlobPart], `${base}.pdf`, { type: 'application/pdf' })
  }

  async function onDownload() {
    setBusy('Generating PDF…')
    setError(null)
    try {
      downloadFile(await makePdfFile())
      setDone(true)
    } catch (e) {
      console.error(e)
      setError(describeError(e, 'generating the PDF'))
    } finally {
      setBusy(null)
    }
  }

  const canShare = typeof navigator !== 'undefined' && 'canShare' in navigator

  async function onShare() {
    setBusy('Generating PDF…')
    setError(null)
    try {
      const file = await makePdfFile()
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: file.name })
        setDone(true)
      } else {
        setError({ message: 'Sharing files is not supported on this browser. Use Download instead.' })
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        console.error(e)
        setError(describeError(e, 'sharing the PDF'))
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="app">
      <section className="panel">
        <h2>1. Add pages</h2>
        <div className="add-row">
          <button type="button" className="primary" onClick={onSnap} disabled={full}>
            📷 Snap pages
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={full}>
            🖼️ Choose photos
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={autoCrop} onChange={(e) => setAutoCrop(e.target.checked)} />
          Auto-crop documents (find the page edges and straighten)
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            onPickFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {/* Fallback when live camera isn't available: the OS camera app. */}
        <input
          ref={captureRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            onPickFiles(e.target.files)
            e.target.value = ''
          }}
        />

        <PageGrid
          pages={pages}
          filter={filter}
          watermark={watermark}
          onEdit={editCrop}
          onRotate={rotate}
          onMove={move}
          onRemove={remove}
        />
        <p className="hint">
          {pages.length
            ? `${pages.length} page${pages.length === 1 ? '' : 's'} (max ${MAX_PAGES}). Tap a page to adjust its crop.`
            : 'No pages yet. Snap or choose photos to start: you can pick many at once.'}
        </p>
      </section>

      <section className="panel">
        <h2>2. Enhance</h2>
        <FirstPageFilterPicker pages={pages} value={filter} onChange={setFilter} />
        <p className="hint">Applies to all pages. Magic colour is great for paper documents.</p>
      </section>

      <section className="panel">
        <h2>3. PDF settings</h2>
        <Segmented
          label="Page size"
          value={pageSize}
          onChange={setPageSize}
          options={[
            ['a4', 'A4'],
            ['letter', 'Letter'],
            ['fit', 'Fit to photo'],
          ]}
        />
        <Segmented
          label="Margins"
          value={margin}
          onChange={setMargin}
          options={[
            ['none', 'None'],
            ['small', 'Small'],
            ['large', 'Large'],
          ]}
        />
        <Segmented
          label="Quality"
          value={quality}
          onChange={setQuality}
          options={[
            ['small', 'Smaller file'],
            ['balanced', 'Balanced'],
            ['high', 'Best'],
          ]}
        />
        <label className="field">
          <span>File name</span>
          <input
            type="text"
            value={fileName}
            maxLength={80}
            onChange={(e) => setFileName(e.target.value)}
            placeholder={`Scan-${dateStamp()}`}
          />
        </label>
      </section>

      <section className="panel">
        <h2>4. Watermark (optional)</h2>
        <label className="check">
          <input type="checkbox" checked={wmOn} onChange={(e) => setWmOn(e.target.checked)} />
          Add a watermark to every page
        </label>
        {wmOn && (
          <div className="wm-options">
            <WatermarkControls value={wm} onChange={setWm} target="page" />
          </div>
        )}
      </section>

      <ErrorBox error={error} />

      <div className="actions">
        <button type="button" className="primary" disabled={!hasPages || !!busy} onClick={onDownload}>
          Download PDF
        </button>
        {canShare && (
          <button type="button" disabled={!hasPages || !!busy} onClick={onShare}>
            Share
          </button>
        )}
        <button type="button" className="ghost" onClick={clearAll}>
          Clear all
        </button>
      </div>
      <SupportNote show={done} />

      {overlay?.kind === 'camera' && (
        <Camera
          title="pages"
          shape="document"
          multi={{ count: shots, onDone: onCameraDone }}
          onCancel={onCameraDone}
          onCapture={onCameraCapture}
          onFallback={() => {
            setOverlay(null)
            captureRef.current?.click()
          }}
        />
      )}
      {overlay?.kind === 'crop' && (
        <Cropper
          key={overlay.pageId}
          title={`page ${pages.findIndex((p) => p.id === overlay.pageId) + 1}`}
          shape="document"
          source={overlay.source}
          initial={overlay.initial}
          onCancel={() => {
            wipe(overlay.source)
            setOverlay(null)
          }}
          onDone={(r) => onCropDone(overlay.pageId, overlay.source, r)}
        />
      )}
      <BusyOverlay label={busy} />
    </div>
  )
}

/** Thumbnails of all pages, with reorder / rotate / crop / delete buttons. */
function PageGrid(props: {
  pages: Page[]
  filter: FilterId
  watermark: WatermarkOptions | null
  onEdit: (p: Page) => void
  onRotate: (p: Page) => void
  onMove: (index: number, by: -1 | 1) => void
  onRemove: (id: string) => void
}) {
  const { pages, filter, onEdit, onRotate, onMove, onRemove } = props
  // Don't redo every thumbnail on each step of a watermark slider.
  const watermark = useDeferredValue(props.watermark)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const urlsRef = useRef(urls)
  useEffect(() => {
    urlsRef.current = urls
  }, [urls])

  // (Re)build thumbnails for the current filter/watermark; free the ones no longer needed.
  const wmKey = watermark ? JSON.stringify(watermark) : ''
  useEffect(() => {
    let cancelled = false
    const keyOf = (p: Page) => `${p.id}:${p.rev}:${filter}:${wmKey}`
    ;(async () => {
      for (const p of pages) {
        const key = keyOf(p)
        if (cancelled) return
        if (urlsRef.current[key]) continue
        try {
          const url = await thumbnailUrl(p, filter, watermark)
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          setUrls((u) => ({ ...u, [key]: url }))
        } catch (e) {
          console.error(e)
        }
      }
      // Drop thumbnails for removed pages or old settings.
      if (cancelled) return
      const wanted = new Set(pages.map(keyOf))
      setUrls((u) => {
        const next: Record<string, string> = {}
        for (const [k, v] of Object.entries(u)) {
          if (wanted.has(k)) next[k] = v
          else URL.revokeObjectURL(v)
        }
        return next
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, filter, wmKey])

  // Free all thumbnails when leaving the page.
  useEffect(() => () => Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u)), [])

  if (!pages.length) return null
  return (
    <ol className="page-grid">
      {pages.map((p, i) => {
        // Show the newest thumbnail for this page, even while a new one is being made.
        const url =
          urls[`${p.id}:${p.rev}:${filter}:${wmKey}`] ??
          Object.entries(urls).find(([k]) => k.startsWith(`${p.id}:${p.rev}:`))?.[1]
        return (
          <li key={p.id} className="page-tile">
            <button type="button" className="page-thumb" onClick={() => onEdit(p)} aria-label={`Edit crop of page ${i + 1}`}>
              {url ? <img src={url} alt="" /> : <span className="spinner small" />}
              <span className="page-num">{i + 1}</span>
            </button>
            <div className="page-actions">
              <button type="button" onClick={() => onMove(i, -1)} disabled={i === 0} aria-label={`Move page ${i + 1} earlier`}>
                ◀
              </button>
              <button
                type="button"
                onClick={() => onMove(i, 1)}
                disabled={i === pages.length - 1}
                aria-label={`Move page ${i + 1} later`}
              >
                ▶
              </button>
              <button type="button" onClick={() => onRotate(p)} aria-label={`Rotate page ${i + 1}`}>
                ⟳
              </button>
              <button type="button" onClick={() => onRemove(p.id)} aria-label={`Delete page ${i + 1}`}>
                ✕
              </button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Filter picker previewing the first page (or a sample document before any page is added). */
function FirstPageFilterPicker({ pages, value, onChange }: { pages: Page[]; value: FilterId; onChange: (f: FilterId) => void }) {
  const first = pages[0]
  const [base, setBase] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!first) return
    blobToCanvas(first.thumbBase, 240)
      .then((c) => (cancelled ? wipe(c) : setBase(c)))
      .catch(() => setBase(null))
    return () => {
      cancelled = true
    }
  }, [first])
  useReleaseReplaced([base])
  return <FilterPicker base={first ? base : null} sample="document" value={value} onChange={onChange} />
}

/** A labelled row of toggle buttons. */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: [T, string][]
}) {
  return (
    <div className="seg-field">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
