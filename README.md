# Photobook Flipbook Viewer

Static PDF flipbook viewer. The book PDF lives on **Dropbox (recommended)**; you only commit a link in `book-source.txt` (no `book.pdf` in git, no Git LFS).

## Set your PDF link

1. Upload your PDF to Dropbox.
2. Create a share link (any public share link to the PDF).
3. Copy the share link.
4. Open `book-source.txt` and paste that link on its own line (below the comments). It can be a `dl=0` link; the app will convert it to `dl=1`.

To change the book later, replace that one line and redeploy (or refresh the page locally).

## Run locally

Serve this folder with any static server, then open the local URL:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Then visit:

```text
http://127.0.0.1:4173
```

Opening `index.html` directly may fail because the app must fetch `book-source.txt` and the PDF from the network.

## Deploy on Vercel

Import this repo into Vercel. No build step and **no Git LFS** are required.

1. Put your Dropbox link in `book-source.txt`.
2. Deploy. Vercel serves the static files as-is.

## Files

- `book-source.txt` — your Dropbox (or other) PDF link (the only place you change the book).
- `index.html` — application shell.
- `styles.css` — responsive photobook styling.
- `app.js` — loads the PDF and runs the flipbook.
- `vendor/` — PDF.js and PageFlip.
- `logo.png` — nav logo and favicon.

Optional: you can still put `book.pdf` in this folder for local-only use by setting `book-source.txt` to `./book.pdf` instead of a Drive link.
