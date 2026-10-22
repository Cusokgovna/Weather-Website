# Пошаговая инструкция: VS Code / Visual Studio, SQL Server + SSMS, Docker, GitHub

Инструкция для Windows. Делайте шаги по порядку. Все команды выполняются в терминале **в папке проекта** (в VS Code: меню *Terminal → New Terminal*).

Содержание:
0. [Что нужно установить](#0-что-нужно-установить)
1. [Скачать проект и открыть в VS Code / Visual Studio](#1-скачать-проект-и-открыть-его)
2. [SQL Server + SSMS: создать базу данных](#2-sql-server--ssms-создать-базу-данных)
3. [Файл .env с секретами](#3-файл-env-с-секретами)
4. [Запуск сайта без Docker](#4-запуск-сайта-без-docker)
5. [Docker](#5-docker)
6. [GitHub: секреты, Actions, GHCR, Pull Request](#6-github-секреты-actions-ghcr-pull-request)
7. [SEO: замер Lighthouse](#7-seo-замер-lighthouse)
8. [Что положить в отчёты](#8-что-положить-в-отчёты)
9. [Частые ошибки](#9-частые-ошибки)

---

## 0. Что нужно установить

| Программа | Где взять | Зачем |
|---|---|---|
| **Node.js 22 LTS** | https://nodejs.org | запуск сервера сайта (`node -v` должно показать v22 или новее) |
| **Git** | https://git-scm.com | работа с репозиторием |
| **VS Code** (или Visual Studio 2022) | https://code.visualstudio.com | редактор |
| **SQL Server 2022 Express** или **Developer** | https://www.microsoft.com/sql-server/sql-server-downloads | сама СУБД |
| **SQL Server Management Studio (SSMS)** | https://aka.ms/ssms | работа с базой: скрипты, таблицы, диаграмма |
| **Docker Desktop** | https://www.docker.com/products/docker-desktop | контейнеры |
| Ключ **OpenWeather** | https://home.openweathermap.org/api_keys | данные о погоде (бесплатный) |

> ⚠️ **Важно про старый ключ.** Раньше в репозитории лежал файл `config.js` с настоящим ключом OpenWeather. Я удалил его из проекта, но он остался в истории коммитов на GitHub. Зайдите на https://home.openweathermap.org/api_keys, **удалите старый ключ и создайте новый**. Новый ключ кладите только в `.env` и в GitHub Secrets.

Если SQL Server на компьютер поставить нельзя (например, нет прав в колледже) — пропустите установку SQL Server и используйте вариант **5.3** (SQL Server в Docker). SSMS при этом всё равно нужен, чтобы смотреть базу.

---

## 1. Скачать проект и открыть его

```bash
git clone https://github.com/cusokgovna/weather-website.git
cd weather-website
git checkout ccr-a4006541-4rdfpk      # ветка с этими изменениями (или основная ветка после слияния PR)
npm install                           # установит express, mssql, dotenv (папка node_modules в Git не попадает)
```

**VS Code:** *File → Open Folder…* → выбрать папку `weather-website`. Рекомендуемые расширения (VS Code сам предложит): *Docker*, *SQL Server (mssql)*, *GitHub Actions*, *YAML*.

**Visual Studio 2022:** *File → Open → Folder…* → папка проекта. Для Node.js нужен компонент *Node.js development* (Visual Studio Installer → Modify). Терминал: *View → Terminal*. Все команды ниже одинаковы.

Структура проекта:

```
public/        фронтенд: index.html, faq.html, profile.html, 404.html, styles.css, app.js, profile.js, robots.txt, sitemap.xml
server/        бэкенд на Express: app.js (маршруты API), mssqlRepo.js (запросы к SQL Server), auth.js, index.js
database/      SQL-скрипты для SSMS: 01..05
scripts/       db-init.js — выполняет 01..03 из командной строки
tests/         автотесты (node --test)
docs/          ER-диаграмма, SEO-скриншоты, эта инструкция
Dockerfile, .dockerignore, docker-compose.yml, docker-compose.db.yml
.github/workflows/build.yml   GitHub Actions
```

---

## 2. SQL Server + SSMS: создать базу данных

### 2.1. Подключиться к серверу в SSMS
1. Запустите SSMS. Откроется окно **Connect to Server**.
2. **Server type:** Database Engine.
   **Server name:** `localhost\SQLEXPRESS` (если ставили Express) или `localhost` (если Developer / экземпляр по умолчанию). Если не знаете — раскройте список → *Browse for more…* → *Local Servers*.
3. **Authentication:** Windows Authentication.
4. В SSMS 20+ поставьте галочку **Trust server certificate** (иначе будет ошибка сертификата).
5. **Connect**.

### 2.2. Включить вход по логину и паролю (SQL Server Authentication)
Сайт подключается к базе по логину и паролю, а по умолчанию Express разрешает только вход Windows.
1. В **Object Explorer** правой кнопкой по серверу (самая верхняя строка) → **Properties** → **Security**.
2. Выберите **SQL Server and Windows Authentication mode** → **OK**.
3. Правой кнопкой по серверу → **Restart** → **Yes**.

### 2.3. Включить TCP/IP и порт 1433
Express по умолчанию не принимает сетевые подключения — без этого шага сайт (и Docker) не увидят базу.
1. Пуск → найдите **SQL Server 2022 Configuration Manager** (или выполните `SQLServerManager16.msc`).
2. **SQL Server Network Configuration → Protocols for SQLEXPRESS** → **TCP/IP** → правой кнопкой **Enable**.
3. Двойной клик по **TCP/IP** → вкладка **IP Addresses** → в самом низу блок **IPAll**: *TCP Dynamic Ports* — очистить (пусто), *TCP Port* — `1433` → **OK**.
4. **SQL Server Services** → **SQL Server (SQLEXPRESS)** → правой кнопкой **Restart**.

Теперь к серверу можно подключаться как `localhost,1433`.

### 2.4. Выполнить скрипты
1. В SSMS: **File → Open → File…** → `database/01_create_database.sql` → кнопка **Execute** (или F5). Внизу должно быть *Commands completed successfully*.
2. Так же по очереди: `02_schema.sql`, затем `03_seed.sql`.
3. В Object Explorer: правой кнопкой по **Databases** → **Refresh**. Появится база **WeatherDb**, в ней **Tables**: `dbo.Cities`, `dbo.FavoriteCities`, `dbo.SearchHistory`, `dbo.Sessions`, `dbo.Users`, `dbo.UserSettings`, `dbo.WeatherSnapshots`, и в **Views** — `dbo.vw_CityLatestWeather`.
4. Откройте `04_queries.sql`, выделяйте запросы по одному и жмите F5 — это готовые скриншоты для отчёта (таблицы, связи, JOIN-ы).

> Альтернатива шагам 1–2: заполнить `.env` (раздел 3) логином `sa`/своим и выполнить `npm run db:init` — он выполнит те же 01–03.

### 2.5. Создать логин для сайта
1. Откройте `database/05_app_login.sql`.
2. Замените `<ПРИДУМАЙТЕ_ПАРОЛЬ>` на свой пароль (пример формата: `Weather_2026!App`, только придумайте свой).
3. F5. Появится логин `weather_app` с правами только читать и писать данные.
4. **Не сохраняйте файл с паролем в Git** — после выполнения верните заглушку (Ctrl+Z) или закройте без сохранения. Пароль запишите в `.env` и в телефон/менеджер паролей.

### 2.6. ER-диаграмма в SSMS (для отчёта)
1. Object Explorer → **WeatherDb** → правой кнопкой по **Database Diagrams** → **New Database Diagram**.
   Если спросит про установку объектов поддержки диаграмм — **Yes**.
   Если ошибка «database does not have a valid owner» — выполните `ALTER AUTHORIZATION ON DATABASE::WeatherDb TO sa;` и повторите.
2. Выделите все 7 таблиц → **Add** → **Close**. SSMS сам нарисует связи по внешним ключам.
3. Правой кнопкой по пустому месту → **Arrange Tables**. Сохраните диаграмму (Ctrl+S), сделайте скриншот.

Готовая ER-диаграмма также лежит в `docs/database/er-diagram.png`.

### 2.7. Скриншоты таблиц
- правой кнопкой по таблице → **Design** — структура (типы, ключи);
- правой кнопкой по таблице → **Select Top 1000 Rows** — данные;
- раскрыть у таблицы папки **Keys**, **Constraints**, **Indexes**.

---

## 3. Файл .env с секретами

1. Скопируйте шаблон: в терминале `copy .env.example .env` (PowerShell: `Copy-Item .env.example .env`).
2. Откройте `.env` и заполните:

```ini
PORT=3000
OPENWEATHER_KEY=ваш_новый_ключ_openweather
DB_DRIVER=mssql
DB_SERVER=localhost
DB_PORT=1433
DB_INSTANCE=
DB_NAME=WeatherDb
DB_USER=weather_app
DB_PASSWORD=пароль_из_шага_2.5
DB_ENCRYPT=true
DB_TRUST_CERT=true
COOKIE_SECURE=false
```

- Если TCP-порт 1433 из шага 2.3 настроить не получилось, но запущена служба **SQL Server Browser**: `DB_INSTANCE=SQLEXPRESS`, `DB_PORT=` (пусто).
- `.env` уже в `.gitignore` и `.dockerignore` — в GitHub и в Docker-образ он не попадёт. Проверка: `git status` не должен показывать `.env`.
- Быстрый запуск совсем без SQL Server (данные живут в памяти до перезапуска): `DB_DRIVER=memory`.

---

## 4. Запуск сайта без Docker

```bash
npm start          # или npm run dev — перезапуск при изменении файлов
```

В терминале должно появиться:
```
Weather website: http://localhost:3000
Database (mssql) connected
```

Откройте http://localhost:3000. Проверьте:
- поиск города, «My location», переключение темы;
- **Menu → Sign in / Register** → зарегистрируйтесь → звёздочка ☆ добавляет город в избранное;
- **/profile** — имя, аватар, избранное, история поиска (вход демо-пользователем: `demo@example.com` / `demo1234`);
- http://localhost:3000/api/health → `{"status":"ok","db":"mssql","dbConnected":true}`;
- после действий на сайте в SSMS выполните `SELECT * FROM dbo.Users`, `SELECT * FROM dbo.FavoriteCities`, `SELECT * FROM dbo.WeatherSnapshots` — новые строки появились. Это хороший скриншот «сайт работает с БД».

Тесты: `npm test` (должно быть `pass 9`, `skipped 5`; пропущенные — тесты с настоящей БД, они идут в GitHub Actions). Прогнать их на своей базе: PowerShell `$env:DB_INTEGRATION="1"; npm test` (нужен `.env`, логин с правами на запись).

---

## 5. Docker

Запустите **Docker Desktop** и дождитесь *Engine running*.

### 5.1. Собрать образ и запустить контейнер (как в методичке)
1. В `.env` поменяйте `DB_SERVER=localhost` на `DB_SERVER=host.docker.internal` — изнутри контейнера `localhost` это сам контейнер, а `host.docker.internal` — ваш компьютер, где работает SQL Server.
2. Сборка:
   ```bash
   docker build -t weather-website .
   ```
3. Запуск:
   ```bash
   docker run -p 3000:3000 --env-file .env weather-website
   ```
   `-p 3000:3000` — порт компьютера : порт в контейнере; `--env-file .env` — передать переменные окружения (секреты не зашиты в образ).
4. Откройте http://localhost:3000 и http://localhost:3000/robots.txt, http://localhost:3000/sitemap.xml.
5. В Docker Desktop: вкладки **Containers** (запущенный контейнер, логи) и **Images** (образ `weather-website`) — скриншоты в отчёт.
6. Остановка: `Ctrl + C`, либо в другом терминале `docker ps` → `docker stop <CONTAINER ID>`.

### 5.2. То же через docker compose (SQL Server на компьютере)
```bash
docker compose up --build        # Ctrl+C — остановить, docker compose down — удалить контейнер
```

### 5.3. Всё в Docker: сайт + SQL Server 2022 в контейнере
Если SQL Server не установлен на компьютер:
1. В `.env`: `DB_PASSWORD=` придумайте пароль для `sa` (минимум 8 символов, большие/маленькие буквы, цифры, спецсимвол). Остальные `DB_*` compose подставит сам.
2. Запуск:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.db.yml up --build
   ```
   Поднимутся 3 сервиса: `db` (SQL Server), `db-init` (выполнит `database/01..03` и завершится с кодом 0), `web` (сайт).
3. Подключение из SSMS к базе в контейнере: **Server name** `localhost,1433`, **Authentication** *SQL Server Authentication*, **Login** `sa`, **Password** — из `.env`, галочка **Trust server certificate**.
4. Остановить: `docker compose -f docker-compose.yml -f docker-compose.db.yml down` (данные БД сохраняются в томе `mssql-data`; удалить их вместе с контейнерами: добавить `-v`).

### Что есть что
- `Dockerfile` — `FROM node:22-alpine`, `WORKDIR /app`, `COPY package*.json` → `RUN npm ci --omit=dev` (слой кешируется, пока не поменялись зависимости) → `COPY` кода → `ENV`, `EXPOSE 3000`, `USER node` (не root) → `CMD ["node", "server/index.js"]`.
- `.dockerignore` — не пускает в образ `node_modules`, `.env`, ключи, `.git`, тесты и документацию.

---

## 6. GitHub: секреты, Actions, GHCR, Pull Request

### 6.1. Отправить код
```bash
git add .
git commit -m "Описание изменений"
git push -u origin <ваша-ветка>
```
Перед `git add .` проверьте `git status`: в списке **не должно быть** `.env` и `node_modules`.

### 6.2. GitHub Actions (`.github/workflows/build.yml`)
Workflow запускается на каждый push и pull request:
1. **test** — `npm ci` и `npm test` (API, страницы, robots.txt, sitemap.xml, X-Robots-Tag);
2. **db-test** — поднимает временный SQL Server 2022 со случайным паролем, выполняет `database/*.sql` и гоняет те же тесты на настоящей базе;
3. **build** — только если оба теста прошли, это push и ветка основная: собирает Docker-образ и публикует в **GitHub Container Registry** с тегами `latest` и хешем коммита.

Где смотреть: вкладка **Actions** → нужный запуск → job → шаги и логи. Если что-то красное — раскройте упавший шаг, там текст ошибки.

Образ: на главной странице репозитория справа **Packages** → `weather-website`. Скачать и запустить где угодно:
```bash
docker pull ghcr.io/cusokgovna/weather-website:latest
docker run -p 3000:3000 --env-file .env ghcr.io/cusokgovna/weather-website:latest
```
(Если пакет приватный — сначала `docker login ghcr.io -u <логин>` с Personal Access Token с правом `read:packages`, либо в настройках пакета *Change visibility → Public*.)

### 6.3. Secrets
1. Репозиторий → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Name: `OPENWEATHER_KEY`, Secret: ваш новый ключ → **Add secret**. (Тестам он не нужен — у них подставной OpenWeather, — но пригодится для деплоя; и это скриншот для отчёта, рис. 5.6–5.9 методички.)
3. Старые секреты `GH_PAGES_PAT` и т.п. от удалённых workflow для GitHub Pages можно удалить.

Workflow для GitHub Pages я удалил: сайту теперь нужен сервер (API + база), а GitHub Pages отдаёт только статические файлы.

### 6.4. Pull Request
Подробно — в [`docs/pull-requests.md`](pull-requests.md). Кратко: ветка → push → **Compare & pull request** → base = основная ветка → **Create pull request** → дождаться зелёных проверок → **Merge**.

---

## 7. SEO: замер Lighthouse

Готовые скриншоты лежат в `docs/seo/before.png` (91) и `docs/seo/after.png` (100) — я снимал их через Lighthouse CLI. Если преподаватель хочет именно ваш замер:
1. Запустите сайт в Docker (раздел 5) — не через `npm run dev`.
2. Откройте Chrome **в режиме инкогнито** → http://localhost:3000 → F12 → вкладка **Lighthouse**.
3. Mode: **Navigation**, Device: **Desktop**, Categories: **SEO** → **Analyze page load**.
4. Скриншот блока SEO сохраните как `docs/seo/after.png`.
5. Для «до»: `git checkout 813c583` (коммит до изменений), `npx serve .`, тот же замер → `docs/seo/before.png`, потом `git checkout -` обратно.

Проверить вручную: http://localhost:3000/robots.txt, http://localhost:3000/sitemap.xml (должен показаться XML), DevTools → **Network** → любой запрос `/api/...` → **Response Headers** → `X-Robots-Tag: noindex, nofollow`.

---

## 8. Что положить в отчёты

**61–63 (БД и начало разработки):** ER-диаграмма (`docs/database/er-diagram.png` и/или диаграмма из SSMS), скриншоты таблиц (Design + Select Top 1000 Rows), результат `04_queries.sql`, скриншоты сайта (главная, FAQ, профиль после входа), скриншоты кода (`server/app.js`, `server/mssqlRepo.js`, `database/02_schema.sql`), ссылка на репозиторий.

**64–66 (Docker + GitHub Actions):** `Dockerfile` и `.dockerignore`, вывод `docker build`, запущенный контейнер и образ в Docker Desktop, сайт на `localhost:3000` из контейнера, вкладка **Actions** с зелёными `test` / `db-test` / `build`, шаги одного job, **Packages** с образом, раздел **Secrets and variables**, работа с Pull Request (см. `docs/pull-requests.md`), ссылка на публичный репозиторий.

**70–71 (SEO):** `docs/seo/before.png`, `docs/seo/after.png`, `docs/seo/README.md`, ссылка на Pull Request.

---

## 9. Частые ошибки

| Ошибка | Решение |
|---|---|
| `Database (mssql) is NOT reachable: Failed to connect to localhost:1433` | Не включён TCP/IP или порт 1433 (шаг 2.3), не перезапущена служба SQL Server |
| `Login failed for user 'weather_app'` | Не включён смешанный режим (шаг 2.2) или неверный пароль в `.env` |
| `self-signed certificate` / `certificate chain` | В `.env` `DB_TRUST_CERT=true`; в SSMS — галочка *Trust server certificate* |
| Из Docker не подключается к SQL Server на компьютере | В `.env` `DB_SERVER=host.docker.internal`; разрешить входящий порт 1433 в брандмауэре Windows (*Windows Defender Firewall → Advanced settings → Inbound Rules → New Rule → Port → TCP 1433*) |
| На сайте «OPENWEATHER_KEY is not configured» | Не заполнен `OPENWEATHER_KEY` в `.env` (после изменения `.env` перезапустите сервер/контейнер) |
| «OpenWeather API key on the server is invalid» | Новый ключ OpenWeather активируется до 2 часов после создания |
| `docker compose ... db` не стартует: password policy | Пароль `sa` слишком простой — минимум 8 символов, 3 типа символов из 4 |
| `npm test`: «Could not find 'tests/*.test.js'» | Нужен Node.js 22+ (`node -v`) |
| Job `build` в Actions пропущен (skipped) | Так и должно быть для pull request и не основных веток; образ публикуется только после push в основную ветку |
