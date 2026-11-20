# Roots

A shared family tree. Relatives open one link, see the tree, add what they know, and forward the link. Every addition waits for the owner's approval. Living people's details never leave the server.

- Frontend: static HTML/CSS/JS on GitHub Pages (not built yet)
- Database: the "Roots data" Google Sheet (six tabs)
- API: Google Apps Script web app bound to that Sheet, source in `apps-script/Code.gs`
- Photos: the "Roots photos" Drive folder

## API

All responses are JSON with `ok: true|false`; failures carry a readable `error`.

**GET** `?action=tree&token=…` returns the public tree (privacy applied on the server) plus, when `token` is a known device token, `own`: that contributor's pending and recently declined entries.

**POST** (body as `text/plain` JSON, to avoid a CORS preflight):

| action | body | notes |
|---|---|---|
| `tree` | `token` | Same as GET, keeps the token out of the URL |
| `submit` | `token`, `display_name?`, `items[]` | Kinds: `person` (with `ref: "new:x"`), `relationship`, `suggestion`, `tag`, `claim`. Refs link items in one batch. All-or-nothing validation |
| `upload_photo` | `token`, `image` (base64), `mime`, `caption?`, `date_taken?`, `place?`, `source?`, `tags[]` | Resize to about 1600px on the device first |
| `admin_queue` | `key` | Pending items grouped by submission, with duplicate hints and the living-person flag on photos |
| `admin_approve` / `admin_reject` | `key`, `items[{kind,id,data?}]` | People are processed before their links, whatever the order sent |
| `admin_retract` | `key`, `items[]` | Takes back an approval; photos go private again |
| `admin_edit` | `key`, `kind`, `id`, `data` | |
| `admin_merge` / `admin_unmerge` | `key`, `keep`, `drop` / `id` | Merges are logged and fully reversible |
| `admin_tree`, `admin_photo`, `admin_pause`, `admin_set_owner` | `key`, … | |

A request carrying the admin key is approved on arrival, so the owner can seed the tree from the normal page.

Fuzzy dates are strings: `exact:1932-05-14`, `about:1932`, `before:1950-03`, `after:1900`. Empty means unknown.

## Tests

`node apps-script/test/run.js` runs `Code.gs` unchanged against a fake Sheet and Drive. It covers privacy stripping, pending visibility, formula injection, approval order, merge and unmerge, photos, limits and the email digest. Run it before every backend change.

## Deploying the API

The first deployment is the only "New deployment" this project ever makes; its URL is baked into the frontend. After that, every change goes out through Deploy > Manage deployments > edit (pencil) > Version: New version > Deploy, which keeps the URL.
