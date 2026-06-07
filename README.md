# 月女涼麵進銷存系統

## 最簡單的啟動方式

不要直接雙擊 `index.html`。

請雙擊：

```text
START_SYSTEM.bat
```

啟動器會自動完成：

1. 建立專案專用 Python 環境。
2. 安裝 Flask 等必要套件。
3. 建立 `coolnoodle.db` SQLite 資料庫。
4. 建立資料表及範例資料。
5. 啟動 Flask。
6. 開啟 `http://127.0.0.1:5000`。

第一次啟動需要安裝套件，因此會比之後稍久。後續只要再次雙擊
`START_SYSTEM.bat` 即可。

## 關閉系統

雙擊：

```text
STOP_SYSTEM.bat
```

## 資料存放位置

所有資料預設存放於：

```text
coolnoodle.db
```

不需要啟動 XAMPP、MySQL 或 phpMyAdmin。

若要清空並重新建立示範資料，先關閉系統，再刪除 `coolnoodle.db`，
重新執行 `START_SYSTEM.bat`。

## 手動啟動

已完成第一次安裝後，也可以使用：

```powershell
.\.venv\Scripts\python.exe app.py
```

接著開啟：

```text
http://127.0.0.1:5000
```

## 切換到 MySQL（選用）

系統預設使用 SQLite。如果之後確定需要 MySQL，可在啟動前設定：

```powershell
$env:DATABASE_URL="mysql+pymysql://root:密碼@localhost/coolnoodle"
.\.venv\Scripts\python.exe app.py
```
