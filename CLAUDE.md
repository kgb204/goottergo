# Development Guidelines

## Security First

Security is the highest priority when writing or modifying any code in this project.

### Mandatory checks before writing any code

- **A03 – Injection**: Never use `innerHTML`, `outerHTML`, `document.write`, `eval`, or `new Function` with any variable data. Use `textContent`, `createElement`, or template APIs that auto-escape.
- **A05 – Security Misconfiguration**: All new HTML pages must include a Content-Security-Policy meta tag. Never add `unsafe-inline` or `unsafe-eval` to CSP.
- **A04/A08 – Data Integrity**: Always validate and sanitize data read from `localStorage`, `sessionStorage`, URL params, or `postMessage` before use. Use explicit radix with `parseInt`.
- **Input boundaries**: Treat all user input (form fields, URL hash/search, `postMessage`, `localStorage`) as untrusted. Validate at the point of entry.
- **No secret data client-side**: Never embed API keys, tokens, or credentials in JavaScript or HTML.

### Code patterns to avoid

| Unsafe | Safe replacement |
|---|---|
| `el.innerHTML = userValue` | `el.textContent = userValue` |
| `parseInt(x)` | `parseInt(x, 10) \|\| 0` |
| `eval(x)` / `new Function(x)` | Refactor to avoid dynamic execution |
| `document.write(x)` | `document.createElement` + `textContent` |
| Reading `localStorage` without validation | Parse + validate + clamp before use |
