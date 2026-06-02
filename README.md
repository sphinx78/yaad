# Photobook Flipbook Viewer

This is a static local PDF flipbook viewer for `book.pdf` and `logo.png`.

## Run Locally

Serve this folder with any static server, then open the local URL:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then visit:

```text
http://127.0.0.1:4173
```

Opening `index.html` directly may be blocked by browser security because PDF.js needs to fetch `book.pdf`.

## Deploy On Vercel

This repo uses Git LFS for `book.pdf`, because the PDF is larger than GitHub's normal file size limit.

Before deploying on Vercel:

1. Import this GitHub repository into Vercel.
2. Open the project settings in Vercel.
3. Enable Git LFS support for the project.
4. Redeploy if the first import happened before Git LFS was enabled.

No framework build command is needed. The site is plain HTML, CSS, and JavaScript.

## Files

- `index.html` is the application shell.
- `styles.css` contains the responsive premium photobook styling.
- `app.js` renders the PDF lazily and controls the flipbook.
- `vendor/` contains local browser libraries for PDF.js and PageFlip.
- `book.pdf` is tracked with Git LFS and must stay beside `app.js`.
- `logo.png` is used in the top navigation and favicon.
