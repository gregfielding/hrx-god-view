/**
 * Google Places dropdown click fallback (2026-07-09).
 *
 * Live diagnosis on prod (Add New Location dialog, and the same on every
 * autocomplete surface incl. the applicant signup address step): the Places
 * widget's INPUT listeners are healthy (focus/blur/keydown/input — keyboard
 * selection with ArrowDown+Enter works and fires place_changed correctly),
 * but the pac-container is missing its `mousedown` binding entirely — its
 * Google-event registry holds only hover listeners (`mouseout` on the
 * container, `mouseover` per item). Result: suggestions render, clicking one
 * does nothing — the click just blurs the input, which closes the dropdown.
 * Why Google's mouse binding is absent is still unexplained (single Maps
 * script, fresh tab, stable wrapper props — all verified), so this fallback
 * sidesteps the mouse path instead of depending on it.
 *
 * How it works: a document-level capture listener on mousedown over a
 * `.pac-item` prevents default (keeps the input focused — Google's own
 * handler does the same), then waits 150ms. If Google's handler consumed the
 * click, the dropdown is closed / the value changed, and we do nothing. If
 * the dropdown is still open and the value untouched (the broken state), we
 * drive the PROVEN keyboard path on the still-focused input: ArrowDown /
 * ArrowUp to move the highlight to the clicked item, then Enter. Verified
 * end-to-end against the live broken widget (second-item click filled
 * address + city/state/zip correctly).
 *
 * Safe by construction: inert when Google's mouse handling works, scoped to
 * clicks inside `.pac-item`, left-button only, and requires the active
 * element to be an input (the autocomplete's own — nothing else can be
 * focused mid-interaction, since preventDefault stopped the focus change).
 */
export function installPacClickFallback(): void {
  const w = window as any;
  if (w.__pacClickFallbackInstalled) return;
  w.__pacClickFallbackInstalled = true;

  document.addEventListener(
    'mousedown',
    (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const item = target?.closest?.('.pac-item') as HTMLElement | null;
      if (!item) return;
      const container = item.closest('.pac-container') as HTMLElement | null;
      const input = document.activeElement as HTMLInputElement | null;
      if (!container || !input || input.tagName !== 'INPUT') return;

      e.preventDefault();
      const valueAtMousedown = input.value;
      const items = Array.from(container.querySelectorAll('.pac-item'));
      const index = items.indexOf(item);
      if (index === -1) return;

      window.setTimeout(() => {
        const stillOpen =
          container.isConnected && getComputedStyle(container).display !== 'none';
        if (!stillOpen || input.value !== valueAtMousedown) return; // Google handled it

        const kd = (key: string, keyCode: number) =>
          input.dispatchEvent(
            new KeyboardEvent('keydown', {
              key,
              keyCode,
              which: keyCode,
              bubbles: true,
              cancelable: true,
            } as KeyboardEventInit),
          );
        const selIdx = items.findIndex((el) => el.classList.contains('pac-item-selected'));
        if (selIdx === -1) {
          for (let i = 0; i <= index; i++) kd('ArrowDown', 40);
        } else if (selIdx < index) {
          for (let i = 0; i < index - selIdx; i++) kd('ArrowDown', 40);
        } else if (selIdx > index) {
          for (let i = 0; i < selIdx - index; i++) kd('ArrowUp', 38);
        }
        kd('Enter', 13);
      }, 150);
    },
    true,
  );
}
