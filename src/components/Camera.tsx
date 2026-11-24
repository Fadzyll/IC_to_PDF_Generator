import { useEffect, useRef, useState } from 'react'
import { toCanvas } from '../lib/image'
import { defaultQuad, type Quad } from '../lib/perspective'

interface Props {
  title: string
  /** `guide` is the card guide frame in the captured canvas's pixel coordinates (card mode only). */
  onCapture: (frame: HTMLCanvasElement, guide?: Quad) => void
  onCancel: () => void
  /** Use the phone's own camera app instead (called from a tap, so file inputs may open). */
  onFallback: () => void
  /** 'card' shows an IC-shaped guide frame; 'document' shows none. */
  shape?: 'card' | 'document'
  /** Keep the camera open to take several photos in a row (Picture to PDF). */
  multi?: { count: number; onDone: () => void }
}

type TorchCaps = MediaTrackCapabilities & { torch?: boolean }

export function Camera({ title, onCapture, onCancel, onFallback, shape = 'card', multi }: Props) {
  const isCard = shape === 'card'
  const [flash, setFlash] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null)
  const [torch, setTorch] = useState<boolean | null>(null) // null = unsupported
  const [failed, setFailed] = useState(false)

  // Start the rear camera; stop it on close.
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        if ((track.getCapabilities?.() as TorchCaps | undefined)?.torch) setTorch(false)
        const v = videoRef.current!
        v.srcObject = stream
        v.play().catch(() => {})
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // Fit the video frame inside the stage, keeping its aspect ratio.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !dims) return
    const fit = () => {
      const { width, height } = stage.getBoundingClientRect()
      const ratio = dims.w / dims.h
      const w = Math.min(width, height * ratio)
      setFrameSize({ w, h: w / ratio })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [dims])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || torch === null) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] })
      setTorch(!torch)
    } catch {
      setTorch(null)
    }
  }

  const capture = () => {
    const v = videoRef.current
    if (!v || !dims) return
    const frame = toCanvas(v, dims.w, dims.h)
    const s = frame.width / dims.w
    const guide = isCard ? (defaultQuad(dims.w, dims.h).map((p) => ({ x: p.x * s, y: p.y * s })) as Quad) : undefined
    // A quick flash so it's clear a photo was taken (the camera stays open in multi mode).
    setFlash(true)
    setTimeout(() => setFlash(false), 140)
    onCapture(frame, guide)
  }

  const guide = dims && isCard ? defaultQuad(dims.w, dims.h) : null

  return (
    <div className="modal camera" role="dialog" aria-modal="true" aria-label={`Snap ${title}`}>
      <div className="modal-bar">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <strong>Snap {title}</strong>
        {torch !== null ? (
          <button type="button" className="ghost" aria-pressed={torch} onClick={toggleTorch}>
            {torch ? '🔦 On' : '🔦 Off'}
          </button>
        ) : (
          <span style={{ width: 64 }} />
        )}
      </div>
      <div className="cam-stage" ref={stageRef}>
        {failed && (
          <div className="cam-failed">
            <p>Camera isn't available here. You may have blocked camera permission for this site.</p>
            <button type="button" className="primary" onClick={onFallback}>
              Open phone camera instead
            </button>
          </div>
        )}
        <div className="cam-frame" style={frameSize ? { width: frameSize.w, height: frameSize.h } : { visibility: 'hidden' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            onLoadedMetadata={(e) => setDims({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          />
          {guide && dims && (
            <div
              className="cam-guide"
              style={{
                left: `${(guide[0].x / dims.w) * 100}%`,
                top: `${(guide[0].y / dims.h) * 100}%`,
                width: `${((guide[1].x - guide[0].x) / dims.w) * 100}%`,
                height: `${((guide[3].y - guide[0].y) / dims.h) * 100}%`,
              }}
            />
          )}
          {flash && <div className="cam-flash" />}
        </div>
      </div>
      <div className="cam-controls">
        <p>
          {isCard
            ? 'Fit the card inside the frame, on a plain dark surface, in good light.'
            : 'Fill the screen with the page, on a contrasting surface, in good light.'}
        </p>
        <div className="cam-row">
          <span className="cam-count" aria-live="polite">
            {multi && multi.count > 0 ? `${multi.count} page${multi.count === 1 ? '' : 's'}` : ''}
          </span>
          <button type="button" className="shutter" aria-label="Take photo" onClick={capture} disabled={!dims} />
          <span className="cam-done">
            {multi && (
              <button type="button" className="primary" onClick={multi.onDone} disabled={multi.count === 0}>
                Done
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
