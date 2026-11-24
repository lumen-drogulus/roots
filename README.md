# Roots

A shared family tree. Relatives open one link, see the tree, add what they know, and forward the link. Every addition waits for the owner's approval. Living people's details never leave the server.

- Frontend: static HTML/CSS/JS on GitHub Pages (not built yet)
- Database: the "Roots data" Google Sheet (six tabs)
- API: Google Apps Script web app bound to that Sheet, source in `apps-script/Code.gs`
- Photos: the "Roots photos" Drive folder

## API

All responses are JSON with `ok: true|false`; failures carry a readable `error`.

**GET** `?action=tree&token=…` returns the tree (privacy applied on the server) plus, when `token` is a known device token, `own`: that contributor's pending and recently declined entries.

Three views (2026-11-22), named in `meta.view`: `public` (anyone: living people's names, gender, birth year, maiden name, source), `family` (a device whose "this is me" was approved: living people's birthdays, places, notes and partnership dates too), `owner` (the admin key on the `tree` POST: every field, real adoption kinds). Adoption and foster links show as plain `parent` while the child is living, unless the child (or the owner) chose to show it. A document tagging a living person is left out of the public view.

**POST** (body as `text/plain` JSON, to avoid a CORS preflight):

| action | body | notes |
|---|---|---|
| `tree` | `token`, `key?`, `visit?` | Same as GET, keeps the token out of the URL. With the admin key: the owner view. `visit` (`from`, `kind`, `browser`, `first`; since 2026-11-24) logs a page open to the Visits tab, never with the admin key |
| `submit` | `token`, `display_name?`, `items[]` | Kinds: `person` (with `ref: "new:x"`), `relationship`, `suggestion` (on a person, a link, or since 2026-11-23 a photo's `caption`, `date_taken`, `place`, `kind`), `tag`, `claim`. Refs link items in one batch. All-or-nothing validation |
| `upload_photo` | `token`, `image` (base64), `mime`, `kind?` (`photo`/`document`), `caption?`, `date_taken?`, `place?`, `source?`, `tags[]` | JPEG, PNG, WebP, GIF, HEIC/HEIF, TIFF or PDF, up to 10 MB. The page shrinks images it can read (1600px photos, 2400px documents) |
| `own_thumb` | `token`, `id` | A preview of the caller's own pending photo |
| `withdraw`, `own_edit` | `token`, … | A relative's own pending rows only; `own_edit` also fixes their own pending photo's details |
| `set_adoption_shown` | `token` or `key`, `person_id`, `shown` | Only the adopted person (approved claim) or the owner. Applies at once |
| `set_email` | `token`, `email` | The caller's own contact email (empty removes it). Owner only ever sees it; `own.email` returns it to that device |
| `admin_queue` | `key` | Pending items grouped by submission, with duplicate hints and the living-person flag on photos |
| `admin_approve` / `admin_reject` | `key`, `items[{kind,id,data?}]` | People are processed before their links, whatever the order sent |
| `admin_retract` | `key`, `items[]` | Takes back an approval; photos go private again |
| `admin_edit` | `key`, `kind`, `id`, `data` | |
| `admin_merge` / `admin_unmerge` | `key`, `keep`, `drop` / `id` | Merges are logged and fully reversible |
| `admin_tree`, `admin_photo`, `admin_pause`, `admin_set_owner` | `key`, … | |
| `admin_tracker` | `key` | Visits, contributors with emails, and a who-sent-what log. Read-only, skips the lock |

A request carrying the admin key is approved on arrival, so the owner can seed the tree from the normal page.

Fuzzy dates are strings: `exact:1932-05-14`, `about:1932`, `before:1950-03`, `after:1900`. Empty means unknown.

## Tests

`node apps-script/test/run.js` runs `Code.gs` unchanged against a fake Sheet and Drive. It covers privacy stripping, pending visibility, formula injection, approval order, merge and unmerge, photos, limits and the email digest. Run it before every backend change.

## Deploying the API

The first deployment is the only "New deployment" this project ever makes; its URL is baked into the frontend. After that, every change goes out through Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy, which keeps the URL.
