// Keyboard behaviour for radio groups and tabs (WAI-ARIA patterns) and one polite live region.

/** Roving focus for [role=radio] buttons in el: arrows/Home/End move and select; call again after re-rendering the radios. */
export function radioGroup(el: HTMLElement) {
  const radios = () => [...el.querySelectorAll<HTMLButtonElement>('[role=radio]')]
  const rs = radios(), sel = rs.find((r) => r.getAttribute('aria-checked') === 'true' && !r.disabled) ?? rs.find((r) => !r.disabled)
  rs.forEach((r) => { r.tabIndex = r === sel ? 0 : -1 })
  if (el.dataset.rg) return
  el.dataset.rg = '1'
  el.addEventListener('keydown', (e) => {
    const all = radios(), on = all.filter((r) => !r.disabled), i = on.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const k = e.key, n = on.length
    const j = k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % n : k === 'ArrowLeft' || k === 'ArrowUp' ? (i - 1 + n) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1
    if (j < 0) return
    e.preventDefault()
    const idx = all.indexOf(on[j]); on[j].click()
    radios()[idx]?.focus() // the click may re-render the group
  })
}

/** Tabs: el holds [role=tab] buttons with aria-controls; click or arrows/Home/End select one and show its tabpanel. */
export function tabs(el: HTMLElement, onSelect?: (tab: HTMLButtonElement) => void) {
  const list = () => [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')]
  const select = (t: HTMLButtonElement, focus = false) => {
    for (const x of list()) {
      const on = x === t
      x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; x.classList.toggle('on', on)
      document.getElementById(x.getAttribute('aria-controls')!)?.classList.toggle('hidden', !on)
    }
    if (focus) t.focus()
    onSelect?.(t)
  }
  const cur = list().find((t) => t.getAttribute('aria-selected') === 'true') ?? list()[0]
  if (cur) select(cur)
  if (el.dataset.tabs) return
  el.dataset.tabs = '1'
  el.addEventListener('click', (e) => { const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[role=tab]'); if (t && el.contains(t)) select(t) })
  el.addEventListener('keydown', (e) => {
    const ts = list(), i = ts.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const k = e.key, n = ts.length
    const j = k === 'ArrowRight' ? (i + 1) % n : k === 'ArrowLeft' ? (i - 1 + n) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1
    if (j < 0) return
    e.preventDefault(); select(ts[j], true)
  })
}

let region: HTMLElement | null = null
/** Announce a material change to screen readers (not every tick). */
export function announce(text: string) {
  if (!region) { region = document.createElement('div'); region.className = 'sr'; region.setAttribute('aria-live', 'polite'); region.setAttribute('role', 'status'); document.body.append(region) }
  region.textContent = ''
  setTimeout(() => { if (region) region.textContent = text }, 50)
}
