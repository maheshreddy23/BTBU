# Shipping v26 to GitHub

Your local folder (`C:\Users\mredd\Downloads\BTBU`) holds the full history v0 → v25.1, but GitHub only has the first commit and the folder has no GitHub remote yet. These steps publish your history first, then put v26 up as a pull request.

Open **Git Bash** in `C:\Users\mredd\Downloads\BTBU` and run each block in order.

## 1. Connect the folder to GitHub and publish v0 → v25.1
```bash
git remote add origin https://github.com/maheshreddy23/BTBU.git
git push -u origin main
git push origin --tags
```
If the push is rejected with "fetch first" (GitHub has a commit your folder doesn't), run `git pull --rebase origin main`, then `git push -u origin main` again.

When git asks for a password, paste a Personal Access Token: github.com/settings/tokens → *Generate new token (classic)* → tick `repo`.

## 2. Put v26 on its own branch
```bash
git checkout -b v26
```
Now unzip the v26 download and copy **everything inside it** into this folder. Choose *Replace* when Windows asks. Keep your own `config.js`; v26 doesn't include one.

```bash
git add -A
git commit -F RELEASE_v26_COMMIT.txt
git push -u origin v26
```

## 3. Open the pull request
GitHub shows a yellow **Compare & pull request** banner on the repo page. Click it, paste the text from `RELEASE_v26_PR.md` as the description, then click **Create pull request**.

When you're happy with it, click **Merge pull request**. To publish, go to Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

## Optional cleanup after merging
`RELEASE_v26_COMMIT.txt`, `RELEASE_v26_PR.md` and this file can be deleted.
