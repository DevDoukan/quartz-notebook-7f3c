# Kalkan DLP design system

## Product and audience

- Product: Windows endpoint DLP administration for company IT teams and managed-service resellers.
- Public site: explain the current, verified product scope and convert qualified visitors to a demo/support conversation.
- License panel: internal/vendor license operations for server-bound grants. Keep activation credentials one-time visible.
- Stack: static HTML/CSS/JavaScript marketing site; PHP 8 + SQLite/Sodium server-side panel on shared hosting; existing central dashboard remains a separate product UI.

## Source guidance

Derived from UI UX Pro Max local catalogs: B2B Service recommends Accessible & Ethical + Minimalism & Swiss Style, feature-rich showcase, professional blue and neutral gray, credibility and clear ROI. Cybersecurity category suggests security-first, but its Matrix/cyberpunk defaults are intentionally rejected for this B2B audience. Typography: Modern Professional (Poppins/Open Sans) and Minimal Swiss (Inter) catalog entries. Implementation uses system sans stacks to avoid external font requests and improve privacy/performance.

## Visual tokens

- Ink / primary: `#0F172A`; body text: `#1E293B`; muted: `#475569`.
- Primary action: `#0369A1` with white text; focus ring: `#0284C7`.
- Success: `#166534` on `#DCFCE7`; warning: `#92400E` on `#FEF3C7`; danger: `#991B1B` on `#FEE2E2`.
- Page: `#F8FAFC`; surface: `#FFFFFF`; border: `#E2E8F0`; soft blue: `#EFF6FF`.
- Type: `Inter, ui-sans-serif, system-ui, Segoe UI, sans-serif`; 16px base, body line-height 1.6.
- Layout: 12-column desktop grid, content max-width 1160px; mobile-first 20px gutters, 8px spacing rhythm, 12px card radius.
- Motion: 150–220ms state transitions; reduced-motion preference disables nonessential movement.

## Components and UX

- Primary CTA is visible in the first viewport and repeated after capability/architecture sections.
- Native headings, landmark elements, skip link, meaningful SVG labels, visible keyboard focus, and minimum 44px touch targets.
- License status always has text and icon/state, never color alone. Destructive revoke requires explicit confirmation and the row/customer identity is repeated in the dialog.
- License credential appears once after creation; copy action and a reminder to store it on the protected server. Never return it in license-list responses.
- Consent categories are separate: essential, analytics, advertising. Analytics/advertising scripts remain unloaded before opt-in. Consent can be changed later.
- No fabricated customer logos, testimonials, compliance certifications, performance numbers, or unverified endpoint-blocking claims.

## Public SEO and conversion

- One canonical public domain (`https://kalkandlp.com.tr`), localized Turkish title/description, Open Graph, Organization/SoftwareApplication JSON-LD, FAQ content, sitemap, robots, and `llms.txt`.
- Demo CTA is measured only after the visitor opts into analytics/advertising. UTM parameters are not persisted before consent.
- GA4, Google Tag Manager, Google Ads conversion and Meta Pixel IDs are deployment configuration placeholders, never fake live IDs.

## Do not

- Do not describe the product as a Windows minifilter or claim Explorer-wide file-content blocking. The current Windows USB rule is system-level write protection, not content inspection.
- Do not use dark cyberpunk, neon Matrix green, emoji icons, auto-playing demos, fake live metrics, or intrusive cookie consent.
