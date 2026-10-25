// Device-type switcher (3D printers, computers, …) shown at the top of Repairs and Stats.
// Built from the categories the server sends, so a new type in shared/categories.json gets a tab
// without UI changes. Each type's repairs, stats and exports are kept separate.
import { h } from '../dom.js';
import { setCategory, state } from '../state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Outline icons by categories.json "icon"; anything else gets the wrench.
const ICONS = {
  printer: ['M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M3 8h18', 'M10 8h4v4h-4z', 'M11.2 12l.8 1.6.8-1.6', 'M7 17h10'],
  computer: ['M3 5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M6 19h5', 'M8.5 15v4', 'M18 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M18.5 8h2'],
  wrench: ['M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z'],
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || ICONS.wrench) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// onChange(categoryId) re-renders the page for the new type. Hidden when only one type exists.
export function deviceTabs(onChange) {
  if (state.categories.length < 2) return null;
  return h(
    'div',
    { class: 'device-tabs', role: 'group', 'aria-label': 'Device type' },
    state.categories.map((c) =>
      h(
        'button',
        {
          type: 'button',
          class: 'device-tab',
          'aria-pressed': String(c.id === state.category),
          on: {
            click: () => {
              if (c.id === state.category) return;
              setCategory(c.id);
              onChange(c.id);
            },
          },
        },
        icon(c.icon),
        h('span', { text: c.name }),
      ),
    ),
  );
}
