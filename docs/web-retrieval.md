# Web Retrieval

`jupyterlite-ai` ships a `browser_fetch` tool that lets the agent read public web pages.

## `browser_fetch`

- Runs in the browser with `fetch`.
- Good for quick retrieval of public pages that allow cross-origin access.
- Limited by browser rules (CORS), network restrictions, and site-level bot protections.
- Sends requests with credentials omitted (`credentials: "omit"`), so cookie/session-authenticated pages are usually not accessible.

When the tool is selected, the agent is instructed to call `browser_fetch` first for a specific URL, and to explain what the user can do instead when the fetch fails because of CORS, network or access restrictions.

## Troubleshooting

Common causes of a failed fetch:

- The website does not allow cross-origin requests (CORS).
- The website blocks automated access.
- The URL requires a login, session or cookies.

Try another public URL from the same domain, or a service that proxies the page with CORS headers.
