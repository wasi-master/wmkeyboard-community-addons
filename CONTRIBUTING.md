# Sharing an addon

Anyone with a GitHub account can submit a theme, a key layout, an icon pack, a sticker pack, a sound pack, a snippet pack or a plugin made for WM Keyboard. A bot checks it, draws a preview and gives you a link to try it on your phone. A maintainer then publishes it, and from then on everyone sees it under **Settings → Addons**. Plugins are code, so they get a code review on top; see [Plugins](#plugins).

## From the app

Pick **Share with everyone**: the globe on a theme's card, in a layout's ⋮ menu, on an icon pack or sticker pack row, on a plugin's page under Manage plugins or in the plugin editor's ⋮ menu, or the last choice under Export on the Snippets screen (which asks which folder to send). Fill in a name, a short description and a licence, then tap the button. What happens next depends on the size of what you made:

- **Small** (most colour and gradient themes, every layout, most snippet packs, most plugins): the browser opens this repository's form already filled in. Check it and press **Submit new issue**.
- **Medium**: the app copies a `wmkb:1:…` text to the clipboard and opens the form. Paste it into the big box, then submit.
- **Large** (themes with photo backgrounds, nearly every icon, sticker and sound pack): the app saves a `.zip`. Drag it into the big box on the form. For a theme, try **Make smaller** first, which re-saves the background as a JPEG at keyboard width and often gets the theme down to a paste.

The app cannot make sound packs; build one in the [web store's sound pack builder](https://wmkeyboard.pages.dev/addons/new/?type=sound_pack) and use its **Submit to community**, which works the same way. Every other builder in the web store has it too.

## By hand

Open the form for what you are sending: [theme](../../issues/new?template=submit-theme.yml), [layout](../../issues/new?template=submit-layout.yml), [icon pack](../../issues/new?template=submit-icon-pack.yml), [sticker pack](../../issues/new?template=submit-stickers.yml), [sound pack](../../issues/new?template=submit-sound-pack.yml), [snippets](../../issues/new?template=submit-snippets.yml) or [plugin](../../issues/new?template=submit-plugin.yml). The big box takes any of these:

- the `wmkb:1:` text: `wmkb:1:` followed by base64url (no padding) of the zlib-wrapped DEFLATE of the file's bytes (its UTF-8 JSON, or a pack's own zip);
- a `.zip` holding one `theme.wmtheme.json`, `layout.wmlayout.json` or `.wmsnippets.json`, or one `.wmicons`, `.wmstickers`, `.wmsoundpack` or `.wmplugin`;
- an icon, sticker or sound pack or a plugin itself, renamed to `.zip` (GitHub does not take the pack extensions). The bot knows a pack by the `pack.json` at its top and a plugin by its `plugin.json`;
- the JSON itself, pasted as it is, if it fits;
- for layouts, a single layer copied in the layout editor (`"format": "wmkeyboard-layer"`). The bot turns it into a layout whose letters layer is the one you copied.

## What the bot checks

Within a minute of submitting, the bot posts one comment and keeps editing it as it learns more.

1. **The form.** A name of up to 60 characters, a description of up to 500, at most 8 tags, a licence, and the rights box ticked.
2. **The id.** The bot makes one from the name (`Midnight Garden` becomes `midnight-garden`). It has to be free. If you published it yourself before, put it in **Updates** instead.
3. **The file.** It has to unpack and read as the kind of addon the form is for, within the sizes WM Keyboard installs: 16 MB for a theme or a sound pack, 8 MB for an icon pack, 4 MB for a layout or snippet pack, 1 MB for a plugin, and 24 MB for a sticker pack (the most GitHub attaches; the app itself takes 64). A layout that names one of your own themes loses that link, since nobody else has your theme. Packs are published byte for byte as you sent them.
4. **A quick check and preview** with the web store's own readers: the keyboard mock-up for a theme or layout, the grid of icons for an icon pack, the first 24 stickers for a sticker pack. Sound and snippet packs are checked but have nothing to draw. For the newer kinds, only a remark that the app would refuse the file fails this step; the rest (an icon for a slot the app lacks, a sample it ignores) are listed as notes.
5. **The real thing.** The bot then runs WM Keyboard's own importer on the file, the same code your phone runs, and for a theme or layout swaps in a render of the real keyboard. If the app would refuse the file, the comment says so with the app's reason, and that verdict wins over the quick one. Which kinds get this step is set by the repository (see below).

If something fails, edit your issue (the pencil on your first post). Every edit starts the checks again.

A theme whose colours are almost the same as one already published gets a note for the maintainer. That doesn't block it.

## Trying it first

The bot's comment has a link to a trial copy. Open it on your phone and WM Keyboard shows the addon's page with an Install button. The trial copy comes from a separate pending repository, so installing the published version later is a separate install.

## Licences

Pick one when you submit. For themes, layouts, packs and snippets:

- **CC0-1.0**: anyone may do anything with it, no credit needed.
- **CC-BY-4.0**: anyone may use and change it if they credit you.
- **CC-BY-SA-4.0**: as CC BY, and changed versions have to use the same licence.

A plugin is code, and takes a code licence: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC let anyone reuse it with credit; MPL-2.0, LGPL-3.0-or-later, GPL-3.0-or-later and AGPL-3.0-or-later ask that changed versions stay open; CC0-1.0 and Unlicense give it away. If your plugin bundles someone else's code (a package vendored with `wmpy pip`), your licence has to allow theirs, and their notice stays in the files.

Only share what you made, or what you have the right to pass on. That goes for every photo, logo and name in a theme, and every file in a plugin.

## Updates and remixes

To publish a new version, submit again with the addon's id in **Updates**. Only the account that published it can update it; the bot checks the numeric GitHub account id, so renaming your account doesn't lose it. Each update raises the minor version (1.0.0, 1.1.0, …), which is how WM Keyboard knows to offer it. A plugin is the exception: it keeps its own `pluginVersion`, and an update has to raise it.

If your theme started from someone else's, the app fills in **Based on** for you, and the published addon shows "Remix of …" with a link to the original. Leave that line as it is.

## Plugins

A plugin is a Python program that runs inside the keyboard, so it gets more checking than a theme, and a person reads it before anyone else can install it. Every permission is allowed, including the risky ones that reach the internet or read what the user typed. What a plugin may do is the reviewer's question, not the bot's.

### Sending one

The quickest way is `wmpy publish` in the plugin's folder. It runs `wmpy check`, the tests and `wmpy pack`, shows what it is about to send, and files the issue (with a GitHub token from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token`) or opens the form filled in. **Share with everyone** in the app and **Submit to community** in the web plugin editor do the same from there. By hand: run `wmpy pack`, rename the `.wmplugin` to `.zip` and drag it into the [plugin form](../../issues/new?template=submit-plugin.yml).

Before you send it:

- Run `wmpy check` and `wmpy test` and fix what they report. The bot runs both.
- Say in the description what it does, and if it goes online, which service and why.
- Ask only for the permissions and hosts it uses. Each one is a line a reviewer asks about.
- Take out keys, tokens, passwords and test data. A `secret` setting is where a user's own key goes.
- The id in `plugin.json` is the folder the plugin lives in on a phone. It has to be one no other published plugin uses, and an update keeps it.
- `pluginVersion` is three numbers, such as `1.0.0`. An update raises it.

### What the bot checks and shows

On top of the form checks above:

1. **The archive**, read as the app reads it: at most 64 files and 4 MB unpacked, `plugin.json` with `"format": "wmkeyboard-plugin"`, the script it names, modules Python can import, assets and translations under the names the app takes. The `.wmplugin` itself is at most 1 MB, the most the app downloads for a plugin.
2. **The plugin id and version**: free or yours, kept on an update, three numbers, higher than the published one.
3. **`wmpy check`**, the same check that runs in editors and in `wmpy publish`, with the app's own manifest rules.
4. **`wmpy test`**, when the plugin has a `test.py` or a `tests/` folder. Tests run in wm-python's sandbox, in a job with no token and no write access.

The comment then lists, for the reviewer and for you:

- the permissions, grouped as the app groups them: listed ones that apply on install, and risky ones that stay off until the user grants them, each flagged ⚠️. A plugin that can both read what the user has and send data away gets a warning of its own, as it does in the app;
- the hosts it may reach, and any `host` setting that lets the user add their own server;
- its providers, selection actions, keyword, settings and the file types it opens;
- every file with its size, and the code of each, collapsed one file per block (a file too long for the comment is linked on the `pending` branch);
- for an update, the permissions and hosts that are new, and the unified diff against the published version.

The issue is labelled `ready` only when every check passes, `wmpy check` included, and the tests pass when there are any. A plugin with a risky permission also gets `risky-permissions`.

### Reviewing a plugin

A maintainer reads every file before `/approve`. In particular:

- **It does what the description says, and nothing else.** No hidden features, no code that only runs on a date or for some users.
- **Network**: every host in `hosts` has a reason. Nothing the user typed, read from the field or clipboard, or stored, is sent anywhere the description does not say. URLs are not built from text the user did not mean to send.
- **Reading**: `field.read`, `clipboard.read`, `files`, `location`, `calendar` and `todo` are used where the panel shows it, for what the user asked.
- **No code from outside**: no `exec` or `eval` of downloaded text, no strings decoded and run, no minified or obfuscated code. Vendored packages are real packages, at a version a reviewer can look up.
- **Secrets**: no keys or tokens in the code. A user's own key belongs in a `secret` setting.
- **An update**: read the diff, and ask about any new permission or host.

If something is unclear, ask in the issue before approving. `/reject <reason>` when it does not meet these, with the reason the submitter needs to fix it.

## For maintainers

Comment on a submission:

- `/approve` publishes it: the bot copies it into `addons/`, writes `meta.json`, regenerates `wmkeyboard-repo.json` and `README.md`, commits to `main` and closes the issue. It refuses while the preview is still rendering, and until the issue is labelled `ready`.
- `/reject <reason>` closes it as not planned and quotes the reason.
- `/rename <new-id>` checks it again under a different id.

Only accounts with write access can use them. The bot asks GitHub, so there is no list of names to keep up to date.

Never edit `wmkeyboard-repo.json` or `README.md` by hand: run `npm run generate` in `bot/`. CI fails when either is stale. The repository id, `com.wasimaster.wmkeyboard.community`, is what installed addons are keyed on, so it never changes.

### Setting up a copy of this repository

1. Run the **Create labels** workflow once. The issue forms can only apply the `submission` and `type:…` labels if they exist; run it again after a new kind is added.
2. Both renderers read the latest WM Keyboard release, looked up on every run. To hold them on one release instead, set the repository variable `WMKEYBOARD_REF` to its tag; clear it to follow the latest again.
3. Until that release contains the `AddonShots` test class, set `FULL_RENDER` to `off`. The quick preview's verdict then stands on its own.
4. `FULL_RENDER_TYPES` lists the kinds the JVM pass runs for, comma-separated; unset, it is `theme,layout`. A release's `AddonShots` refuses a kind it predates as unknown, so add `icon_pack,stickers,sound_pack,snippets` only once the release checked against handles them. Until then those kinds get the quick verdict. Plugins never take the JVM pass: wmpy checks them instead.
5. `WMPY_VERSION` names the release of [wmpy](https://github.com/wasi-master/wmpy/releases) the plugin check downloads, such as `v0.1.0`, so a new wmpy release changes nothing until you move it. Unset, or when that release has no Linux x86_64 build, the job builds wmpy from WM Keyboard's source with `cargo install`, which takes a few minutes.
6. Under Settings → Actions → General, give workflows read and write permission. The bot's write jobs push to `main` and to the `pending` branch.

The bot lives in `bot/`: TypeScript on Node 20, tested with `npm test`. The tests need no wmpy: the plugin check takes the command as a function, and they hand in a fake that answers as wmpy does. To try the real one on a plugin, put a `request.json` (`{"type": "plugin", "id": "echo", "file": "plugin.wmplugin"}`) and the `.wmplugin` in a folder, then run `RENDER_DIR=<folder> OUT_DIR=<out> WMPY=$(which wmpy) npx tsx src/cli/wmpy.ts`.
