# Packaging fixtures

Throwaway apps that install the packed tarballs, so export maps and type
resolution are exercised the way a consumer sees them rather than through
workspace links. Run them all with `pnpm check:fixtures`, or one at a time with
`pnpm check:fixtures node` and the like.

| Fixture | Module resolution | What it proves |
| --- | --- | --- |
| `node` | `nodenext` | The strictest consumer setup resolves every entry point and its types. |
| `vite-react` | `bundler` | `@pylo/react` typechecks and bundles into a browser build. |
| `nextjs` | `bundler` | The route handler, server client and client hooks all still build after the refactor. |
| `expo` | Metro | Metro resolves the packages, and the React Native upload source typechecks. |

The tarballs are extracted into `node_modules` by hand rather than handed to
`npm install`. Installing local `file:` specs makes npm re-resolve the whole
tree, which has left sibling dependencies half written.

## Known issue with the Expo fixture

`expo export` bundles the packages correctly, and has been observed doing so
(627 modules, all four Pylo packages resolved). It is also prone to failing on
this machine with `Unable to resolve module <x>` for third-party packages that
are present on disk, which reproduces on a clean install carrying no Pylo
packages at all. That is Metro's file crawler, not the packages under test.

If you hit it: `node check-single-instance.mjs && tsc --noEmit` still covers
resolution and types, and those are the parts this fixture is really here for.
