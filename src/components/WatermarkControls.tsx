import {
  CAPTION_PRESETS,
  type WatermarkOptions,
  type WatermarkPosition,
} from '../lib/watermark'

/** Caption, presets, position, colour, size, opacity, date and tiling for the diagonal watermark. */
export function WatermarkControls({
  value: wm,
  onChange,
  target = 'card',
}: {
  value: WatermarkOptions
  onChange: (w: WatermarkOptions) => void
  /** What the watermark covers, for the "repeat across the whole …" label. */
  target?: string
}) {
  const update = <K extends keyof WatermarkOptions>(k: K, v: WatermarkOptions[K]) => onChange({ ...wm, [k]: v })
  return (
    <>
      <label className="field">
        <span>Caption</span>
        <input
          type="text"
          value={wm.text}
          maxLength={60}
          onChange={(e) => update('text', e.target.value.toUpperCase())}
          placeholder="FOR PRIVATE USE ONLY"
        />
      </label>
      <div className="chips">
        {CAPTION_PRESETS.map((p) => (
          <button key={p} type="button" className={wm.text === p ? 'chip active' : 'chip'} onClick={() => update('text', p)}>
            {p.replace(/^FOR /, '').replace(/ ONLY$/, '')}
          </button>
        ))}
      </div>

      <div className="grid">
        <label className="field">
          <span>Position</span>
          <select value={wm.position} onChange={(e) => update('position', e.target.value as WatermarkPosition)} disabled={wm.tile}>
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
            <option value="center">Across centre</option>
          </select>
        </label>
        <label className="field">
          <span>Colour</span>
          <input type="color" value={wm.color} onChange={(e) => update('color', e.target.value)} />
        </label>
        <label className="field">
          <span>Size ({Math.round(wm.scale * 100)}%)</span>
          <input type="range" min={0.6} max={2} step={0.05} value={wm.scale} onChange={(e) => update('scale', +e.target.value)} />
        </label>
        <label className="field">
          <span>Opacity ({Math.round(wm.opacity * 100)}%)</span>
          <input type="range" min={0.2} max={1} step={0.05} value={wm.opacity} onChange={(e) => update('opacity', +e.target.value)} />
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={wm.includeDate} onChange={(e) => update('includeDate', e.target.checked)} />
        Add today's date
      </label>
      <label className="check">
        <input type="checkbox" checked={wm.tile} onChange={(e) => update('tile', e.target.checked)} />
        Repeat across the whole {target} (harder to crop out)
      </label>
    </>
  )
}
