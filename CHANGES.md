# Changes in this build

## Interface
- Swiss Modernism visual style applied across the client (client/src/styles/app.css): white, near-black, one red accent, square corners, numbered navigation, hairline rules.
- New public landing page at `/`; sign-in moved to `/login`.
- Responsive layout for narrow screens.

## Vendor management
- Vendor list with status filter chips (with counts) and search.
- Side panel per vendor: invoice count, open payable, paid total, last invoice date, full details.
- Propose, edit (identity and tax fields restricted by permission), deactivate/reactivate, change bank (second approver), reveal account (audited).
- Client-side validation for GSTIN, PAN, IFSC, account number, e-mail.
- Server: vendor list returns status counts; vendor detail returns invoice statistics and rejection reason; only approved vendors can be switched active/inactive; deactivation blocked while approved/scheduled/released invoices are open.
- Invoices page honours a vendor filter ("View invoices" from a vendor).

## Charts
- components/charts.tsx: bar, ranked horizontal bar and status-mix components, all reading report endpoint data.
- Dashboard: invoices-by-status mix and weekly cash-need chart.
- Reports: AP aging, cash-flow, vendor spend, approval turnaround, TDS by section, reconciliation outcomes.

## Development helpers and tests
- `npm run seed:demo` (server/src/scripts/seed-demo-flow.ts): fills a development database through the real API so charts show real data. Refuses to run in production.
- server/src/tests/integration/vendor_management.test.ts and report_charts.test.ts: NOT YET RUN (need MongoDB).

## Not verified
- All of the above was rendered in a headless browser against a mocked API; the server changes and new tests have not been executed against MongoDB.
- Run `npm run test:integration` against a live database before relying on these changes.
