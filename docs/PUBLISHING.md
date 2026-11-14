# 发布到 GitHub 的步骤

这份是给维护者看的操作清单。仓库里该有的文件已经整理好了，剩下的几步需要在你自己的机器上登录 GitHub 才能做。

## 一、建仓库并推上去

仓库地址已经写死在三个地方，创建时用这个名字，否则要一起改：

- `addon/manifest.json` 的 `homepage_url`
- `addon/manifest.json` 的 `applications.zotero.update_url`（指向 `main` 分支的 `update.json`）
- `package.json` 的 `repository` / `homepage` / `bugs`

```powershell
# 在 GitHub 网页上建一个空仓库 klskzyh/zotero-english-assistant（不要勾 README / .gitignore）
cd C:\DSH\ZoteroTranslate
git remote add origin https://github.com/klskzyh/zotero-english-assistant.git
git push -u origin main
git push origin v0.1.0
```

推上去之后仓库里已有的内容就是完整的可发布状态：`addon/`（插件本体）、`scripts/`（开发脚本）、`testdata/`（自测语料）、`docs/`（开发记录与发布说明）、`README.md`、`CHANGELOG.md`、`LICENSE`、`update.json`、`package.json`、`.gitignore`。

`dist/` 不在仓库里（`.gitignore` 已忽略），打包产物走 Releases。

## 二、发第一个 Release

1. 在仓库页面点「Releases → Draft a new release」。
2. Tag 选 `v0.1.0`（已经在本地打好并推上去了）。
3. 标题填 `0.1.0 测试版第一版`。
4. 说明把 `docs/release-notes-0.1.0.md` 的内容整段粘进去。
5. 附件上传 `dist/english-assistant.xpi`（重新打一次：`npm run build`）。
6. 勾上「This is a pre-release」，发布。

发完之后，`README.md` 里「到 Releases 下载最新一版的 english-assistant.xpi」这句就生效了。

## 三、维护更新清单

`update.json` 是 Zotero 检查更新的入口（`manifest.json` 的 `update_url` 指向它）。每发一版要改三处：

```json
{
  "version": "0.2.0",
  "update_link": "https://github.com/klskzyh/zotero-english-assistant/releases/download/v0.2.0/english-assistant.xpi",
  "update_hash": "sha256:<新 XPI 的哈希>"
}
```

取哈希：

```powershell
npm run build
(Get-FileHash dist\english-assistant.xpi -Algorithm SHA256).Hash.ToLower()
```

改完提交到 `main`。用户装上旧版后，Zotero 下次检查更新时会读到这条记录。

打包出来的 XPI 每次哈希都不一样（zip 里带时间戳），所以要**先确定要上传的那份文件，再取它的哈希**；重新打包之后哈希就变了，`update_hash` 要跟着改，否则 Zotero 会校验失败。校验不通过时的表现是更新静默失效，不会报错。

## 四、以后每版的固定流程

```powershell
# 1. 改版本号：addon/manifest.json 与 package.json 两处要一致
# 2. 改 CHANGELOG.md、docs/release-notes-<版本>.md
# 3. 跑验证门
npm run verify
# 4. 打包
npm run build
# 5. 提交并打标签
git add -A
git commit -m "版本 0.2.0"
git tag -a v0.2.0 -m "0.2.0"
git push origin main --tags
# 6. 按上一节的步骤发 Release，并更新 update.json
```

## 五、要注意的几件事

- **版本号**：`0.1.0` 这种纯数字最稳。Zotero 的更新比较按版本号字符串走，`0.1.0-beta.1` 这类带后缀的写法虽然也是合法版本，但排序结果容易出乎意料（`0.1.0-beta.1` 低于 `0.1.0`），发布版和测试版混在一起时容易出问题。想标「测试版」，用 GitHub 的 pre-release 勾选和版本号的 0.x 表达就够了。
- **`addon/manifest.json` 的 `strict_max_version`** 目前是 `10.9.9`，只在 Zotero 10.0.6 上实测过。以后在更高版本上验证过再往上调。
- **别把 API Key 提交进仓库**：`addon/prefs.js` 里只有默认值，用户的 Key 存在 Zotero 自己的配置里，不会进仓库。提交前扫一眼 `git diff` 就行。
- **`docs/` 全部会公开**：里面有开发过程记录和接口核对笔记，已经脱敏过本机路径。不想公开的笔记放 `tmp/`（已被忽略）。
- **要改的元信息**：`LICENSE` 里的版权人、`manifest.json` 的 `author`、`update.json` 的仓库地址，换仓库时一起改。
