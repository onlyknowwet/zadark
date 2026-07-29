# Sticker catalog YAML

The source catalog is maintained at `sticker/stickers.yaml` and loaded from the fixed jsDelivr URL:

```text
https://cdn.jsdelivr.net/gh/onlyknowwet/zadark@HEAD/sticker/stickers.yaml
```

Edit and commit `sticker/stickers.yaml` to publish catalog updates. The extension fetches it as text, parses it with the locally packaged `js-yaml` browser build, and expects HTTPS image URLs. For category tabs like the Zalo picker, use `categories`:

```yaml
version: 1
updatedAt: '2026-07-24T00:00:00Z'
categories:
- id: zany-tu-tri
  name: Zany Tu Tri
  iconUrl: https://photo-zmini-qrmenu.zadn.vn/images/38a508c9348cddd2849d.jpg
  stickers:
  - id: sample-zmini-01
    name: Sample ZMini
    stickerUrl: https://photo-zmini-qrmenu.zadn.vn/images/38a508c9348cddd2849d.jpg
    thumbUrl: https://photo-zmini-qrmenu.zadn.vn/images/38a508c9348cddd2849d.jpg
    width: 512
    height: 512
    tags: [sample]
```

Required per category:

- `id`: stable unique id for the tab.
- `name`: heading shown above that category.
- `stickers`: list of stickers in that category.

Recommended per category:

- `iconUrl`: HTTPS image shown in the bottom tab bar. If omitted, the first sticker is used.

Required per sticker:

- `stickerUrl`: HTTPS URL of the pre-uploaded sticker image.

Recommended per sticker:

- `id`: stable unique id.
- `name`: label shown as image alt/title.
- `thumbUrl`: HTTPS preview image. If omitted, `stickerUrl` is used.
- `width`: sticker image width in pixels. Defaults to `512`.
- `height`: sticker image height in pixels. Defaults to `512`.
- `tags`: optional keywords for future search/filtering.

Simple flat format is still supported; it renders as one `Stickers` category:

```yaml
version: 1
stickers:
- id: sample-zmini-01
  name: Sample ZMini
  stickerUrl: https://photo-zmini-qrmenu.zadn.vn/images/38a508c9348cddd2849d.jpg
  width: 512
  height: 512
```

`packs` is also supported as an alias for categories:

```yaml
version: 1
packs:
- id: my-pack
  name: My Pack
  stickers:
  - id: my-pack-01
    name: Sticker 01
    stickerUrl: https://example.com/sticker-01.webp
    width: 512
    height: 512
```
