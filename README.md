# Asteria — Portfolio

Personal portfolio for Asteria Wang, a Design Engineering student at Imperial College London.

The site is a static, interactive desktop interface featuring project folders, nautical ASCII artwork, and a rotatable 3D desk-tidy model.

## Local preview

From this repository:

```powershell
Set-Location site
python -m http.server 8000
```

Then open <http://localhost:8000/>.

## Deployment

GitHub Actions publishes the contents of `site/` to GitHub Pages whenever `main` is updated.

Live site: <https://diethyletherene.github.io/>
