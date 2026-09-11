# Embedded fonts

This directory contains self-hosted Traditional Chinese variable fonts used by the notice generator.

| Family in the app | Source file | Weight range |
| --- | --- | --- |
| `Course Notice Sans` | `NotoSansTC-Variable.woff2` | 100–900 |
| `Course Notice Serif` | `NotoSerifTC-Variable.woff2` | 200–900 |

Sources:

- <https://github.com/google/fonts/tree/main/ofl/notosanstc>
- <https://github.com/google/fonts/tree/main/ofl/notoseriftc>

The WOFF2 files were converted from the variable TTF files in the official Google Fonts repository using FontTools 4.65.0 and Brotli 1.2.0, without subsetting or changing the font names internally.

`sans.data.js` and `serif.data.js` contain Base64 copies of the same WOFF2 files. They are loaded only when a `file://` page exports PNG, because Chromium does not allow JavaScript to fetch neighboring local files. The online version fetches the binary WOFF2 files directly.

Both families are distributed under the SIL Open Font License. See the two `OFL-*.txt` files in this directory.
