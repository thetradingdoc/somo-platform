# Patient portal UI — source of truth

**Source of truth:** `unified-dashboard/patients/patient-dashboard.html`  
**Live reference:** `http://localhost:4000/patients/patient-dashboard.html`

All in-app patient pages must use the same shell, navigation, theme, and chrome so the experience is consistent.

---

## 1. Layout

- **Structure:** `.layout` with fixed **sidebar** (260px) and **main** (`.main-content` with `margin-left: 260px`).
- **Page background:** `#f7fafc` (or `var(--gray-50)` where appropriate).
- **Main content:** `padding: 32px`, no max-width unless the page needs it (e.g. forms).

---

## 2. Theme (CSS variables)

Use the same palette on every patient page:

```css
:root {
  --primary: #1e40af;
  --primary-dark: #1e3a8a;
  --primary-light: #3b82f6;
}
```

- **Do not** use a different `--primary` (e.g. teal or green) on sub-pages.
- **theme-color** meta: `#1e40af`.

---

## 3. Sidebar

### 3.1 Header

- **Logo text:** `Consʌlt` (use `ʌ` in place of the “u”).
- **Subtitle:** `Home Care Works`.

### 3.2 Navigation (exactly 6 items)

| Label           | Target / behavior                          |
|----------------|--------------------------------------------|
| Dashboard      | `patient-dashboard.html`                   |
| My Benefits    | `#benefits` (or dashboard scroll)         |
| My Wallet      | `wallet.html`                              |
| Bills & Claims | `#claims` (or dashboard scroll)            |
| Appointments   | `appointments.html`                        |
| My Records     | `my-records.html`                          |

- Each item: icon + label, `.nav-item`, `.nav-item.active` on current page.
- Same order and labels everywhere.

### 3.3 Footer

- **User block:** avatar (e.g. initial), display name, role label **“Patient Account”** (not “Patient” only).
- **Logout:** single button (e.g. 🚪) that calls the same logout flow as the dashboard.
- Footer must be present on every in-app page (no “logout only in top bar” elsewhere).

---

## 4. Chrome

- **Mobile:** Same pattern as dashboard:
  - `.mobile-menu-toggle` button to open/close sidebar.
  - `.mobile-menu-overlay` when menu is open.
  - Sidebar slides in from the left; same breakpoint (e.g. 768px) and behavior.
- **Global assets:** `../assets/css/global.css`, `../assets/js/config.js`, `../manifest.webmanifest` where applicable.

---

## 5. Pages to align (checklist)

| Page              | Status |
|-------------------|--------|
| patient-dashboard | ✅ Reference |
| appointments      | ✅ Done (full shell, 6 nav, footer, theme) |
| wallet            | ✅ Done (theme, “Patient Account”, 6 nav) |
| my-records        | ✅ Done (logo, subtitle, full nav, footer) |
| profile           | ✅ Done (full dashboard shell) |
| schedule          | ✅ Done (nav, footer, theme, mobile) |
| video-call        | ✅ Done (“Back to dashboard” link) |

---

## 6. Optional: shared shell

To avoid drift, consider:

- A shared **patient shell** (e.g. `patient-shell.css` or a small JS that injects sidebar HTML).
- New patient pages should reuse that shell instead of redefining sidebar/layout.

---

*Last updated from conversation: patient UI consistency fixes; patient-dashboard.html as single source of truth.*
