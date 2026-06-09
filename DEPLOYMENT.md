# 線上部署與資料同步

GitHub Pages 只能放 HTML、CSS、JavaScript，不能執行 Flask，也不能直接使用專案內的 SQLite 檔案。

本專案支援以下架構：

- GitHub：保存程式碼
- Render：執行 Flask 網站與 API
- Neon PostgreSQL：保存所有使用者共用的線上資料
- GitHub Pages（選用）：只放前端介面，呼叫 Render API

## 建議方式：直接使用 Render 網址

這是最簡單的方式。部署完成後，直接開啟 Render 提供的網址即可使用，不需要另外設定 GitHub Pages。

### 1. 建立 Neon 資料庫

1. 前往 [Neon](https://neon.com/) 並建立免費專案。
2. 複製 PostgreSQL connection string，建議使用 pooled connection。
3. 連線字串格式會類似：

```text
postgresql://帳號:密碼@主機名稱/資料庫名稱?sslmode=require
```

### 2. 上傳 GitHub

請把目前這一層的專案內容上傳成 GitHub repository 根目錄：

```text
System_Design-Project--main/
├─ app.py
├─ config.py
├─ index.html
├─ render.yaml
└─ requirements.txt
```

不要把外層同名資料夾一起包進 repository，否則 Render 會找不到 `render.yaml`。

### 3. 部署 Render

1. 前往 [Render Dashboard](https://dashboard.render.com/)。
2. 選擇 **New > Blueprint**。
3. 連接剛才的 GitHub repository。
4. Render 會讀取 `render.yaml`。
5. 設定環境變數：

| 名稱 | 值 |
|---|---|
| `DATABASE_URL` | Neon 提供的 PostgreSQL connection string |
| `CORS_ORIGINS` | 初次測試可填 `*` |

6. 完成部署後，開啟 Render 提供的 `https://...onrender.com` 網址。

此網址同時提供介面與 API，所有人使用的資料都會同步到 Neon。

## 選用方式：使用 GitHub Pages 網址

如果一定要用 `https://你的帳號.github.io/專案名稱/`：

1. 先完成上面的 Render 與 Neon 部署。
2. 到 GitHub repository 的 **Settings > Secrets and variables > Actions > Variables**。
3. 新增 repository variable：

```text
名稱：API_BASE_URL
值：https://你的服務.onrender.com
```

4. 到 **Settings > Pages**，將 Source 設為 **GitHub Actions**。
5. 推送到 `main` 分支後，`.github/workflows/pages.yml` 會自動部署前端。
6. 回到 Render，把 `CORS_ORIGINS` 改成 GitHub Pages 網址的 origin：

```text
https://你的帳號.github.io
```

多個網址可用逗號分隔，例如：

```text
https://你的帳號.github.io,https://自訂網域.example.com
```

## 重要提醒

- 不要把 Neon 密碼或 `DATABASE_URL` 寫進 GitHub 檔案。
- Render 的本機磁碟不適合保存 SQLite，因此線上環境必須設定 PostgreSQL。
- 目前系統沒有登入與權限驗證。公開網址後，知道網址的人都能查看與修改資料。
- 本機仍可使用 `START_SYSTEM.bat` 啟動，未設定 `DATABASE_URL` 時會自動使用 SQLite。

