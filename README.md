# CSV Preflight

Local catalogue checks with human-reviewed semantic column mapping.

The browser runs the open Xenova/all-MiniLM-L6-v2 embedding model to suggest SKU, title, price and currency columns. A person reviews those choices before a deterministic CSV audit checks missing or duplicate SKUs, empty titles, invalid or negative prices, unsupported currencies and inconsistent row widths. The audit keeps source starting lines; it does not rewrite product records.

## Try locally

With an existing Node installation, run `node server.mjs`, then open http://127.0.0.1:8766/. No npm install or hosted API is needed. Run `node tests.mjs` for the core test suite.

Choose **Load synthetic sample**, **Suggest column mapping**, review the four selections and check the confirmation box, then **Check catalogue**. **Download audit JSON** exports findings and mapping/model evidence. The sample contains five records and six findings affecting three records.

The app can also be served as static files over HTTPS; relative paths support a project subdirectory. That path layout was tested on a local nested URL. No public deployment has been made yet.

## Measured prototype results

- 15 core tests passed for CSV quoting/newlines/BOM, malformed input, row width, missing/duplicate IDs, numeric boundaries and ambiguous mappings.
- Six development fixtures: 23/24 expected field decisions, versus 16/24 for exact aliases. These results informed an explicit multiple-price-candidate guard.
- Four separately frozen holdout fixtures: 14/16 expected decisions, versus 8/16 for aliases. Two uncertain mappings were left unselected. No incorrect selected mapping occurred in these four cases. This is a small synthetic test, not general accuracy or customer evidence.
- Synthetic file input and real JSON download were verified. A CSV record containing HTML remained literal data.
- Test-session resource entries were loopback-only; the local server recorded no CSV request body or write method. Remote model downloads are disabled. The included server restricts connections with a same-origin CSP. A future static host must retain equivalent deployment controls for that policy guarantee.

Limits: English comma-delimited UTF-8 input, 1 MB, 30 columns, 5,000 records, four product fields and a displayed currency subset. SKU comparisons are case-sensitive after trimming. This is not an importer compatibility certificate, tax check or commercial savings benchmark. There are no customer, sales or revenue claims.

## Model/runtime provenance

Model revision: `751bff37182d3f1213fa05d7196b954e230abad9`. Transformers.js 3.8.1 uses the ONNX WASM backend. Existing general-purpose licensed model/runtime assets were reused; the application, audit code and fixtures are new. See `MODEL_PROVENANCE.json`, model README, vendor LICENSE and vendor/onnx/LICENSE.

The new application code is MIT licensed; third-party model/runtime assets retain the licences listed above. This project is not an accepted contest entry or commissioned product.
