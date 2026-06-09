# 月女涼麵進銷存管理系統

## 本機一鍵啟動

請執行：

```text
START_SYSTEM.bat
```

第一次啟動會自動：

1. 建立 Python 虛擬環境。
2. 安裝 Flask 與所需套件。
3. 建立 `coolnoodle.db` SQLite 資料庫。
4. 建立資料表與範例資料。
5. 啟動 Flask。
6. 開啟 `http://127.0.0.1:5000`。

停止系統請執行：

```text
STOP_SYSTEM.bat
```

## GitHub 與線上資料同步

GitHub Pages 只能提供靜態網頁，不能執行 Flask，也不能同步專案內的 SQLite 檔案。

本專案已支援：

- GitHub：保存程式碼。
- Render：執行 Flask 網站與 API。
- Neon PostgreSQL：保存所有裝置共用的資料。
- GitHub Pages：可選用的靜態前端網址。

完整設定請看 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 手動啟動

```powershell
.\.venv\Scripts\python.exe app.py
```

開啟：

```text
http://127.0.0.1:5000
```

未設定 `DATABASE_URL` 時，系統會使用本機 SQLite。線上部署時請透過環境變數提供 PostgreSQL 連線字串。

