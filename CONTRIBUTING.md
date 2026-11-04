# Sharing an addon

Anyone with a GitHub account can submit a theme, a key layout, an icon pack, a sticker pack, a sound pack or a snippet pack made for WM Keyboard. A bot checks it, draws a preview and gives you a link to try it on your phone. A maintainer then publishes it, and from then on everyone sees it under **Settings → Addons**.

## From the app

Pick **Share with everyone**: the globe on a theme's card, in a layout's ⋮ menu, on an icon pack or sticker pack row, or the last choice under Export on the Snippets screen (which asks which folder to send). Fill in a name, a short description and a licence, then tap the button. What happens next depends on the size of what you made:

- **Small** (most colour and gradient themes, every layout, most snippet packs): the browser opens this repository's form already filled in. Check it and press **Submit new issue**.
- **Medium**: the app copies a `wmkb:1:…` text to the clipboard and opens the form. Paste it into the big box, then submit.
- **Large** (themes with photo backgrounds, nearly every icon, sticker and sound pack): the app saves a `.zip`. Drag it into the big box on the form. For a theme, try **Make smaller** first, which re-saves the background as a JPEG at keyboard width and often gets the theme down to a paste.

The app cannot make sound packs; build one in the [web store's sound pack builder](https://wmkeyboard.pages.dev/addons/new/?type=sound_pack) and use its **Submit to community**, which works the same way. Every other builder in the web store has it too.

## By hand

Open the form for what you are sending: [theme](../../issues/new?template=submit-theme.yml), [layout](../../issues/new?template=submit-layout.yml), [icon pack](../../issues/new?template=submit-icon-pack.yml), [sticker pack](../../issues/new?template=submit-stickers.yml), [sound pack](../../issues/new?template=submit-sound-pack.yml) or [snippets](../../issues/new?template=submit-snippets.yml). The big box takes any of these:

- the `wmkb:1:` text: `wmkb:1:` followed by base64url (no padding) of the zlib-wrapped DEFLATE of the file's bytes (its UTF-8 JSON, or a pack's own zip);
- a `.zip` holding one `theme.wmtheme.json`, `layout.wmlayout.json` or `.wmsnippets.json`, or one `.wmicons`, `.wmstickers` or `.wmsoundpack`;
- an icon, sticker or sound pack itself, renamed to `.zip` (GitHub does not take the pack extensions). The bot knows it by the `pack.json` at its top;
- the JSON itself, pasted as it is, if it fits;
- for layouts, a single layer copied in the layout editor (`"format": "wmkeyboard-layer"`). The bot turns it into a layout whose letters layer is the one you copied.

## What the bot checks

Within a minute of submitting, the bot posts one comment and keeps editing it as it learns more.

1. **The form.** A name of up to 60 characters, a description of up to 500, at most 8 tags, a licence, and the rights box ticked.
2. **The id.** The bot makes one from the name (`Midnight Garden` becomes `midnight-garden`). It has to be free. If you published it yourself before, put it in **Updates** instead.
3. **The file.** It has to unpack and read as the kind of addon the form is for, within the sizes WM Keyboard installs: 16 MB for a theme or a sound pack, 8 MB for an icon pack, 4 MB for a layout or snippet pack, and 24 MB for a sticker pack (the most GitHub attaches; the app itself takes 64). A layout that names one of your own themes loses that link, since nobody else has your theme. Packs are published byte for byte as you sent them.
4. **A quick check and preview** with the web store's own readers: the keyboard mock-up for a theme or layout, the grid of icons for an icon pack, the first 24 stickers for a sticker pack. Sound and snippet packs are checked but have nothing to draw. For the newer kinds, only a remark that the app would refuse the file fails this step; the rest (an icon for a slot the app lacks, a sample it ignores) are listed as notes.
5. **The real thing.** The bot then runs WM Keyboard's own importer on the file, the same code your phone runs, and for a theme or layout swaps in a render of the real keyboard. If the app would refuse the file, the comment says so with the app's reason, and that verdict wins over the quick one. Which kinds get this step is set by the repository (see below).

If something fails, edit your issue (the pencil on your first post). Every edit starts the checks again.

A theme whose colours are almost the same as one already published gets a note for the maintainer. That doesn't block it.

## Trying it first

The bot's comment has a link to a trial copy. Open it on your phone and WM Keyboard shows the addon's page with an Install button. The trial copy comes from a separate pending repository, so installing the published version later is a separate install.

## Licences

Pick one when you submit:

- **CC0-1.0**: anyone may do anything with it, no credit needed.
- **CC-BY-4.0**: anyone may use and change it if they credit you.
- **CC-BY-SA-4.0**: as CC BY, and changed versions have to use the same licence.

Only share what you made, or what you have the right to pass on. That goes for every photo, logo and name in a theme.

## Updates and remixes

To publish a new version, submit again with the addon's id in **Updates**. Only the account that published it can update it; the bot checks the numeric GitHub account id, so renaming your account doesn't lose it. Each update raises the minor version (1.0.0, 1.1.0, …), which is how WM Keyboard knows to offer it.

If your theme started from someone else's, the app fills in **Based on** for you, and the published addon shows "Remix of …" with a link to the original. Leave that line as it is.

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
4. `FULL_RENDER_TYPES` lists the kinds the JVM pass runs for, comma-separated; unset, it is `theme,layout`. A release's `AddonShots` refuses a kind it predates as unknown, so add `icon_pack,stickers,sound_pack,snippets` only once the release checked against handles them. Until then those kinds get the quick verdict.
5. Under Settings → Actions → General, give workflows read and write permission. The bot's write jobs push to `main` and to the `pending` branch.

The bot lives in `bot/`: TypeScript on Node 20, tested with `npm test`.
