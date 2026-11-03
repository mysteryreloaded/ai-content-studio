# UI sizes

The size and spacing scale for `apps/web` (issue #222). These sizes override
the prototype's: take layout, colours and components from the prototype, and
sizes from here. Colours and the accent are issue #191's to change, and the
Landing's own layout is still a prototype issue — but even on those pages the
sizes below apply. The Workbench and Admin pages keep working through the
shared components but are not restyled yet (#192–#211).

Everything below lives in `apps/web/src/index.css` (the type scale, the
rhythm, `--app-header-h`) and the shared components in
`apps/web/src/components/ui/`. Pages use the shared components and the named
rhythm classes; they do not carry their own size values.

## Type

- Body: 16px on a 1.6 line-height.
- Headings: 1.25 line-height, the condensed heading face.

| Level  | Size       |
| ------ | ---------- |
| `h1`   | 32px; 40px at 1024px and up |
| `h2`   | 24px       |
| `h3`   | 20px       |
| `h4`   | 17px       |

Paragraphs and lists carry a 16px (1em) bottom margin in the base layer.

## Controls

Heights are fixed, not derived from the type:

| Control                          | Size                        |
| -------------------------------- | --------------------------- |
| Button (default)                 | 40px tall, 16px horizontal padding |
| Button `sm`                      | 36px, 12px padding          |
| Button `lg`                      | 48px, 24px padding          |
| Input, select trigger (default)  | 40px, 12px padding, 16px text |
| Input, select trigger `sm`       | 36px                        |
| Textarea                         | 40px minimum, 12px / 10px padding, 16px text |
| Tabs trigger, toggle (default)   | 40px                        |
| Tabs trigger, toggle `sm`        | 36px                        |
| Tabs trigger, toggle `lg`        | 48px                        |
| Menu items (select, dropdown)    | 36px minimum                |

- A label sits 6–8px from the control it labels. A label row for a
  radio-group item, checkbox or switch is 40px tall with a 10px
  control-to-text gap (the `Label` primitive's `min-h-10` and `gap-2.5`).
- The tab list takes the height of its 40px triggers (`h-fit`).

## Cards, tables, menus

- Card padding: 24px, 20px on phones and on `size="sm"` cards, from the
  `--card-padding` token on the `Card` primitive. The gaps between a
  card's own sections are 16px.
- Table rows are 48px tall; cell padding is 12px vertical, 16px horizontal.

## The page frame

- Page container (`RootLayout`): 16px side padding on phones, 32px at 768px
  and up, 40px above and below; the prototype's max-width is kept.
- `AppHeader`: 64px tall, from `--app-header-h` — the Model editor's sticky
  header and checks rail (#213) offset from that token. Nav links sit 24px
  apart (8px below 560px, where they wrap).
- `Footer`: 32px vertical padding, 24px between its items.

## The rhythm

Vertical spacing on the restyled pages (Landing, Models home, Terms,
Privacy, Waiting, Account) comes from three named classes in `index.css`,
not per-page values:

- `gap-fields` — 20px: between stacked form fields.
- `gap-content` — 24px: between a title and its content.
- `gap-sections` — 40px: between groups and sections.

Each is a `gap` on a flex or grid column, and each zeroes the base-layer
bottom margins of its direct `p`/`ul`/`ol` children, so the named value is
the only spacing in the column.
