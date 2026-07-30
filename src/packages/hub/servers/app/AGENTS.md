# Public Browser Route Rules

- A client-side route that users can open directly must have an explicit
  Express entry route. Frontend route parsing alone is insufficient: a direct
  browser request reaches the hub before React loads.
- Keep `public-auth.ts` synchronized with
  `frontend/public/auth/routes.ts`. This is especially important for emailed
  links because URL fragments containing tokens are unavailable to the server.
- Add a direct HTTP regression to `public-auth.test.ts` for every new public
  auth route family. The test must begin at the clean user-facing URL, not at
  `/static/public.html`.
- Keep the representative auth-link probe in `cli software smoke`; a release
  that returns `404` before loading the public shell must fail smoke testing.
