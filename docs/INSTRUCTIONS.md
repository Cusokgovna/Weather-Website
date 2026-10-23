# Kraken Shop — полное руководство разработчика

Здесь всё, что нужно, чтобы запустить проект у себя и дальше развивать его самостоятельно: VS Code (или Visual Studio), Microsoft SQL Server + SSMS, Docker, GitHub.
Инструкция для Windows. Делайте разделы по порядку: в первый раз всё займёт около часа.

**Содержание**

0. [Что за проект и как он устроен](#0-что-за-проект-и-как-он-устроен)
1. [Установка программ (один раз)](#1-установка-программ-один-раз)
2. [Открыть проект в VS Code или Visual Studio](#2-открыть-проект-в-vs-code-или-visual-studio)
3. [Быстрый запуск без базы данных](#3-быстрый-запуск-без-базы-данных)
4. [SQL Server и SSMS: создать базу](#4-sql-server-и-ssms-создать-базу)
5. [Файл .env с паролями](#5-файл-env-с-паролями)
6. [Запуск с настоящей базой](#6-запуск-с-настоящей-базой)
7. [Docker](#7-docker)
8. [GitHub: репозиторий, Actions, образ, секреты, Pull Request](#8-github-репозиторий-actions-образ-секреты-pull-request)
9. [Как продолжать разработку](#9-как-продолжать-разработку)
10. [Безопасность: что уже сделано и правила](#10-безопасность-что-уже-сделано-и-правила)
11. [SEO и замер Lighthouse](#11-seo-и-замер-lighthouse)
12. [Что положить в отчёты](#12-что-положить-в-отчёты)
13. [Частые ошибки](#13-частые-ошибки)

---

## 0. Что за проект и как он устроен

**Kraken Shop** — биржа игровых ценностей по макету «Kraken Shop». Пользователи продают и покупают предметы, валюту, аккаунты и услуги для 16 игр, а также подарочные карты и подписки (раздел Services).

| Что | Как работает |
|---|---|
| Каталог | Левое меню с играми → страница игры (`/games/stalzone`) → лот (`/listings/1`) |
| Покупка | Деньги списываются с баланса и **замораживаются**; продавец получает их, только когда покупатель нажмёт «I received it — confirm» |
| Чат | Кнопка «TO CHAT» на лоте → чат с продавцом (`/chat/5`), «CALL SUPPORT», картинки через скрепку, системные сообщения о сделке |
| Спор и возврат | Покупатель открывает спор, продавец может вернуть деньги — товар возвращается в продажу |
| Аккаунт | «Account information»: дата создания, Nickname, Real name, рейтинг ☆, Deals conducted, Social credit, баланс, история кошелька |
| Special code | Необязательный второй секрет при входе (включается в настройках аккаунта) |
| Exchange rate | Курсы евро и доллара хранятся в БД и раз в 12 часов обновляются с сайта ЦБ РФ |
| News, FAQ, About us, Contacts, Privacy policy, Rules | Обычные страницы |

**Стек:** Node.js 22 + Express 5 (сервер), HTML/CSS/JS (страницы собираются на сервере), Microsoft SQL Server 2022 (база, хранимые процедуры), Docker, GitHub Actions, GHCR.

```
Браузер ──► server/app.js (маршруты)
              ├─ страницы:  /, /games/:slug, /listings/:id, /users/:name, /account, /chat/:id ... → server/views.js (HTML)
              ├─ API:       /api/... (JSON) ← public/js/*.js (кнопки, формы, чат)
              └─ картинки:  /img/listings/:id, /img/avatars/:name (хранятся в БД)
                     │
                     ▼
              server/mssqlRepo.js ──► Microsoft SQL Server, база KrakenShop
              (server/memoryRepo.js — та же логика в памяти: для тестов и режима «демо»)
```

| Папка / файл | Что внутри |
|---|---|
| `server/app.js` | все адреса сайта и API, проверки прав, ошибки |
| `server/views.js` | HTML всех страниц (шапка, меню игр, подвал, страницы) |
| `server/html.js` | шаблонизатор `html\`...\`` — сам экранирует данные (защита от XSS) |
| `server/mssqlRepo.js` | все SQL-запросы (только параметризованные) |
| `server/memoryRepo.js` | та же логика в памяти (тесты, демо) |
| `server/auth.js` | хеширование паролей (scrypt), сессии |
| `server/rates.js` | курсы валют |
| `server/config.js` | настройки из `.env` |
| `public/css/style.css` | все стили (цвета — переменные в начале файла) |
| `public/js/` | скрипты страниц: `chat.js`, `sell.js`, `account.js`, `listing.js`, `auth.js`, `common.js` |
| `public/img/` | логотип, иконки, картинка промо |
| `database/` | SQL-скрипты для SSMS |
| `tests/` | автотесты |
| `docs/` | эта инструкция, ER-диаграмма, скриншоты, SEO |

---

## 1. Установка программ (один раз)

| Программа | Где взять | Как проверить |
|---|---|---|
| **Node.js 22 LTS** | https://nodejs.org → LTS → установщик, все галочки по умолчанию | в терминале `node -v` → `v22...` |
| **Git** | https://git-scm.com/download/win | `git --version` |
| **VS Code** | https://code.visualstudio.com | — |
| **SQL Server 2022 Express** (или Developer) | https://www.microsoft.com/sql-server/sql-server-downloads → Express → *Basic* | служба «SQL Server (SQLEXPRESS)» в `services.msc` |
| **SSMS** (SQL Server Management Studio) | https://aka.ms/ssms | — |
| **Docker Desktop** | https://www.docker.com/products/docker-desktop | `docker --version`, внизу Docker Desktop — *Engine running* |

После установки Git один раз представьтесь:
```bash
git config --global user.name "Ваше Имя"
git config --global user.email "ваша@почта"
```

> Нет прав ставить SQL Server (например, в колледже)? Пропустите его: базу можно поднять в Docker (раздел 7.3), а SSMS подключится к ней.

---

## 2. Открыть проект в VS Code или Visual Studio

**Получить код** — один из вариантов:
- из GitHub: `git clone https://github.com/<логин>/<репозиторий>.git`, затем `cd <репозиторий>`;
- из архива: распакуйте zip в папку **без кириллицы и пробелов** в пути (например, `C:\dev\kraken-shop`).

### VS Code (рекомендуется)
1. *File → Open Folder…* → папка проекта.
2. Справа внизу появится «Install recommended extensions» → **Install** (SQL Server, Docker, GitHub Actions, YAML).
3. Терминал: *Terminal → New Terminal* (Ctrl+`).
4. Установите зависимости (папка `node_modules`, в Git не попадает):
   ```bash
   npm install
   ```

### Visual Studio 2022
1. В *Visual Studio Installer → Modify* отметьте нагрузку **Node.js development**.
2. *File → Open → Folder…* → папка проекта.
3. Терминал: *View → Terminal*. Дальше команды те же: `npm install`, `npm run demo`, `npm start`, `npm test`.
4. Базу в Visual Studio видно в *View → SQL Server Object Explorer* (Add SQL Server → `localhost\SQLEXPRESS`), но для скриптов и диаграмм удобнее SSMS.

> Отладка с точками останова и готовые кнопки запуска (раздел 3) настроены для VS Code (`.vscode/launch.json`). В Visual Studio запускайте через терминал.

---

## 3. Быстрый запуск без базы данных

Проверка, что всё установлено правильно, — SQL Server для этого не нужен.

- **VS Code:** вкладка *Run and Debug* (Ctrl+Shift+D) → сверху выберите **«Kraken Shop: demo without SQL Server»** → зелёная кнопка ▶ (или F5).
- **Или в терминале:** `npm run demo`

Откройте http://localhost:3000. Вход: **demo / demo1234**. Данные живут в памяти и пропадут после остановки (красный квадрат в панели отладки или Ctrl+C в терминале).

---

## 4. SQL Server и SSMS: создать базу

### 4.1. Подключиться в SSMS
1. Запустите SSMS → окно **Connect to Server**.
2. *Server type:* Database Engine. *Server name:* `localhost\SQLEXPRESS` (Express) или `localhost` (Developer). Не знаете — раскройте список → *Browse for more… → Local Servers*.
3. *Authentication:* **Windows Authentication**.
4. *Encryption:* Mandatory и галочка **Trust server certificate** (в SSMS 20+ без неё будет ошибка сертификата).
5. **Connect**.

### 4.2. Включить вход по логину и паролю
Сайт подключается к базе логином и паролем, а Express по умолчанию пускает только Windows-пользователей.
1. В *Object Explorer* правой кнопкой по серверу (верхняя строка) → **Properties → Security**.
2. **SQL Server and Windows Authentication mode** → OK.
3. Правой кнопкой по серверу → **Restart** → Yes.

### 4.3. Включить TCP/IP и порт 1433
Без этого ни сайт, ни Docker не достучатся до SQL Server.
1. Пуск → **SQL Server 2022 Configuration Manager** (или Win+R → `SQLServerManager16.msc`).
2. *SQL Server Network Configuration → Protocols for SQLEXPRESS* → **TCP/IP** → правой кнопкой **Enable**.
3. Двойной клик по TCP/IP → вкладка **IP Addresses** → в самом низу **IPAll**: *TCP Dynamic Ports* — очистить, *TCP Port* — `1433` → OK.
4. *SQL Server Services* → **SQL Server (SQLEXPRESS)** → правой кнопкой **Restart**.

### 4.4. Выполнить скрипты
*File → Open → File…* → файл → кнопка **Execute** (F5). Строго по порядку:

| Файл | Что делает |
|---|---|
| `database/01_create_database.sql` | создаёт базу **KrakenShop** |
| `database/02_schema.sql` | 12 таблиц, ключи, ограничения, индексы, представление `vw_SellerStats` |
| `database/03_procedures.sql` | хранимые процедуры: покупка, подтверждение, возврат, пополнение, чат |
| `database/04_seed.sql` | тестовые данные: 16 игр + 2 сервиса, 48 разделов, 18 лотов, 5 пользователей, сделки, чаты, отзыв, новости, курсы |
| `database/06_app_login.sql` | логин `kraken_app` для сайта (сначала замените `<ПРИДУМАЙТЕ_ПАРОЛЬ>`!) |

После каждого файла внизу должно быть *Commands completed successfully*. Затем в Object Explorer: правой кнопкой по **Databases → Refresh** → появится **KrakenShop**.

Про `06_app_login.sql`: впишите свой пароль (минимум 8 символов, большие и маленькие буквы, цифры, спецсимвол), выполните, а потом **закройте файл без сохранения** — пароль не должен попасть в Git. Сам пароль запишите в `.env` (раздел 5) и куда-нибудь себе (телефон, менеджер паролей).

> Скрипты идемпотентные: если что-то пошло не так, их можно запустить ещё раз. Начать с нуля:
> `ALTER DATABASE KrakenShop SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE KrakenShop;` — затем снова 01 → 04 и 06.

> Альтернатива ручному запуску 01–04 — команда `npm run db:init` (берёт настройки из `.env`, нужен логин с правом создавать базы, например `sa`).

### 4.5. ER-диаграмма в SSMS
1. *KrakenShop* → правой кнопкой по **Database Diagrams → New Database Diagram**. На вопрос об установке объектов поддержки — **Yes**.
   Ошибка «does not have a valid owner» → выполните `ALTER AUTHORIZATION ON DATABASE::KrakenShop TO sa;` и повторите.
2. Выделите все 12 таблиц → **Add → Close**. Связи SSMS нарисует сам по внешним ключам.
3. Правой кнопкой по пустому месту → **Arrange Tables** → Ctrl+S → скриншот.

Готовая диаграмма с описанием: `docs/database/er-diagram.png` и `docs/database/README.md`.

### 4.6. Посмотреть данные
- правой кнопкой по таблице → **Select Top 1000 Rows** — данные;
- **Design** — структура (типы, ключи);
- папки **Keys / Constraints / Indexes** у таблицы;
- `database/05_queries.sql` — готовые запросы: каталог, рейтинг продавцов, сделки, кошелёк, чаты, проверка «баланс = сумма операций». Выделите один запрос мышкой → F5.

---

## 5. Файл .env с паролями

1. В терминале VS Code: `copy .env.example .env` (PowerShell: `Copy-Item .env.example .env`).
2. Откройте `.env` и заполните:

```ini
PORT=3000
SITE_URL=https://example.com
DB_DRIVER=mssql
DB_SERVER=localhost
DB_PORT=1433
DB_INSTANCE=
DB_NAME=KrakenShop
DB_USER=kraken_app
DB_PASSWORD=пароль_из_06_app_login.sql
DB_ENCRYPT=true
DB_TRUST_CERT=true
COOKIE_SECURE=false
```

- Не получилось настроить порт 1433 (раздел 4.3), но работает служба **SQL Server Browser** → `DB_INSTANCE=SQLEXPRESS` и `DB_PORT=` (пусто).
- `.env` уже в `.gitignore` и `.dockerignore`. Проверка: `git status` **не должен** показывать `.env`.
- На компьютере в колледже: пароль сохраните у себя (телефон, заметки), а `.env` создавайте заново на каждом компьютере.

---

## 6. Запуск с настоящей базой

- **VS Code:** Run and Debug → **«Kraken Shop: run with SQL Server (.env)»** → F5.
- **Или:** `npm start` (или `npm run dev` — сервер сам перезапускается при сохранении файлов).

В терминале должно быть:
```
Kraken Shop: http://localhost:3000
Database (mssql) connected
```

Проверьте:
1. http://localhost:3000/api/health → `{"status":"ok","db":"mssql","dbConnected":true}`.
2. Войдите как **demo / demo1234** → меню (ник справа вверху) → **Account** → пополните баланс («Top up»).
3. Слева **Stalzone** → «Gauss Gun — Epic» → **To chat** → напишите сообщение, прикрепите картинку скрепкой → **Purchase**.
4. В чате появится сделка → **I received it — confirm** → оставьте отзыв.
5. Выйдите и войдите как **SkinMaster / demo1234** → **My deals → Sales** → деньги пришли продавцу; **Sell an item** → создайте свой лот с картинкой.
6. В SSMS: `SELECT * FROM dbo.Orders`, `dbo.Messages`, `dbo.Transactions` — видны новые строки. Это хороший скриншот «сайт работает с базой».

**Автотесты:** `npm test` → в конце `pass 16`, `skipped 7` (пропущены тесты на настоящей базе — они идут в GitHub Actions).
Прогнать их на своей базе (PowerShell): `$env:DB_INTEGRATION="1"; npm test` → `pass 23`.

---

## 7. Docker

Запустите **Docker Desktop** и дождитесь *Engine running*.

### 7.1. Что подключает Docker к сайту
- `Dockerfile` — рецепт образа: `FROM node:22-alpine` → `WORKDIR /app` → `COPY package*.json` + `RUN npm ci --omit=dev` (слой кешируется) → `COPY` кода → `ENV`, `EXPOSE 3000` → `USER node` (не root) → `CMD ["node", "server/index.js"]`.
- `.dockerignore` — в образ не попадут `node_modules`, `.env`, ключи, `.git`, тесты, документация.
- Пароли в образ **не зашиваются**: их передают при запуске (`--env-file .env`).
- `docker-compose.yml` — запуск сайта одной командой; `docker-compose.db.yml` — добавляет SQL Server 2022 в контейнере и автоматическую инициализацию базы.

### 7.2. Сайт в Docker, SQL Server на вашем компьютере
1. В `.env` замените `DB_SERVER=localhost` на `DB_SERVER=host.docker.internal` (изнутри контейнера `localhost` — это сам контейнер, а `host.docker.internal` — ваш компьютер).
2. Собрать образ:
   ```bash
   docker build -t kraken-shop .
   ```
3. Запустить контейнер:
   ```bash
   docker run --rm -p 3000:3000 --env-file .env kraken-shop
   ```
   `-p 3000:3000` — порт компьютера : порт в контейнере; `--env-file .env` — переменные окружения; `--rm` — удалить контейнер после остановки.
4. Откройте http://localhost:3000, http://localhost:3000/robots.txt, http://localhost:3000/sitemap.xml.
5. Docker Desktop → **Containers** (контейнер, логи) и **Images** (образ) — скриншоты в отчёт.
6. Остановить: Ctrl+C, либо в другом терминале `docker ps` → `docker stop <CONTAINER ID>`.

То же через compose (сам соберёт образ и возьмёт `.env`):
```bash
docker compose up --build        # Ctrl+C — остановить; docker compose down — удалить контейнер
```

### 7.3. Всё в Docker: сайт + SQL Server 2022
Если SQL Server не установлен на компьютер:
1. В `.env` задайте `DB_PASSWORD=` — пароль для `sa` (минимум 8 символов, 3 вида символов из 4). Остальные `DB_*` compose подставит сам.
2. Запуск:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.db.yml up --build
   ```
   Поднимутся три сервиса: `db` (SQL Server), `db-init` (выполнит `database/01…04` и завершится с кодом 0), `web` (сайт на http://localhost:3000).
3. **SSMS к базе в контейнере:** *Server name* `localhost,1433` (через запятую!), *Authentication* — SQL Server Authentication, *Login* `sa`, *Password* — из `.env`, галочка *Trust server certificate*.
4. Остановить: `docker compose -f docker-compose.yml -f docker-compose.db.yml down`. Данные базы сохраняются в томе `mssql-data`; удалить их тоже — добавьте `-v`.

### 7.4. Полезные команды
| Команда | Что делает |
|---|---|
| `docker ps` / `docker ps -a` | запущенные / все контейнеры |
| `docker logs -f <id>` | логи контейнера в реальном времени |
| `docker compose logs -f web` | логи сайта в compose |
| `docker exec -it <id> sh` | зайти внутрь контейнера |
| `docker images` | список образов |
| `docker compose up --build` | **пересобрать** после изменения кода и запустить |
| `docker system prune` | удалить неиспользуемые контейнеры и образы (освободить место) |

После любых изменений кода образ нужно пересобрать (`--build`), иначе в контейнере останется старая версия.

---

## 8. GitHub: репозиторий, Actions, образ, секреты, Pull Request

### 8.1. Первый push
1. github.com → **New repository** → имя (например, `kraken-shop`) → **Public** → без README → Create.
2. В терминале в папке проекта:
   ```bash
   git init
   git add .
   git status
   ```
   **Проверьте список: `.env` и `node_modules` там быть не должно!**
   ```bash
   git commit -m "Kraken Shop: first version"
   git branch -M main
   git remote add origin https://github.com/<логин>/kraken-shop.git
   git push -u origin main
   ```
   (Если проект уже склонирован из GitHub — шаги `init` и `remote add` не нужны.)

### 8.2. GitHub Actions (`.github/workflows/build.yml`)
Запускается на каждый push и Pull Request:
1. **test** — `npm ci` + `npm test` (API, страницы, SEO, защита от XSS/CSRF);
2. **db-test** — поднимает временный SQL Server 2022 со случайным паролем, выполняет `database/01…04` и гоняет те же тесты на настоящей базе;
3. **build** — только если оба теста зелёные, это push и ветка основная: собирает Docker-образ и публикует в **GitHub Container Registry** с тегами `latest` и хешем коммита.

Где смотреть: вкладка **Actions** → запуск → job → шаги и логи. Красный шаг — раскройте, там текст ошибки.

Если `build` падает с ошибкой 403 при публикации: *Settings → Actions → General → Workflow permissions → Read and write permissions → Save*.

### 8.3. Образ в GHCR
Главная страница репозитория → справа **Packages** → `kraken-shop`. Запустить где угодно:
```bash
docker pull ghcr.io/<логин>/kraken-shop:latest
docker run --rm -p 3000:3000 --env-file .env ghcr.io/<логин>/kraken-shop:latest
```
Если пакет приватный: в настройках пакета *Change visibility → Public*, либо `docker login ghcr.io -u <логин>` с токеном (`read:packages`).

### 8.4. Secrets
Тестам секреты не нужны (пароль временной базы генерируется в самом workflow). Если понадобятся (деплой, внешние сервисы): *Settings → Secrets and variables → Actions → New repository secret*. Значение после сохранения увидеть нельзя — только заменить. Если секрет всё-таки попал в коммит — **сразу смените его**: удаление коммита не помогает, он остаётся в истории.

### 8.5. Pull Request
Подробно с командами — `docs/pull-requests.md`. Коротко: новая ветка → коммиты → `git push -u origin <ветка>` → на GitHub **Compare & pull request** → дождаться зелёных проверок → **Merge**.

---

## 9. Как продолжать разработку

### 9.1. Рабочий цикл
1. Обновиться: `git checkout main` → `git pull`.
2. Новая ветка под задачу: `git checkout -b feature/favorites`.
3. Запустить `npm run dev` (автоперезапуск) или F5 в VS Code — точки останова ставятся кликом слева от номера строки.
4. Менять код → обновлять страницу в браузере (Ctrl+F5, если стиль не обновился).
5. `npm test` — всё зелёное.
6. `git add .` → `git status` (нет `.env`!) → `git commit -m "Что сделано"` → `git push -u origin feature/favorites` → Pull Request.

### 9.2. Как проходит запрос (чтобы найти, где менять)
Пример: страница игры `/games/stalzone`.
1. `server/app.js` → `page.get('/games/:slug', ...)` — берёт игру и лоты через `repo.searchListings(...)`.
2. `server/mssqlRepo.js` → `searchListings` — SQL-запрос к таблицам `Listings`, `Categories`, `Games`.
3. `server/views.js` → `catalog(...)` — HTML страницы; карточка лота — `itemCard(...)`.
4. `public/css/style.css` — внешний вид (`.item-card`, `.big-title`, ...).

Кнопки и формы работают через API: например, «Purchase» → `public/js/listing.js` → `POST /api/orders` → `app.js` → `repo.createOrder` → процедура `dbo.usp_CreateOrder`.

### 9.3. Добавить новую страницу (пример: «Promotions»)
1. В `server/views.js` напишите функцию по образцу `news(...)`: `layout(ctx, { title, description, path, main: html\`...\` })`. Только **один `<h1>`** на странице и свой `title`/`description`.
2. Добавьте её в `module.exports` внизу файла.
3. В `server/app.js` рядом с `page.get('/news', ...)` добавьте `page.get('/promotions', async (req, res) => send(res, views.promotions(await pageContext(req))));`.
4. Ссылку — в шапку (`header` в `views.js`) или в подвал (`footer`).
5. Публичная страница → добавьте адрес в `sitemap.xml` (`app.get('/sitemap.xml', ...)`); закрытая → `noindex: true` и строка `Disallow:` в `public/robots.txt`.
6. Тест в `tests/api.test.js` (например, добавьте путь в `PUBLIC_PAGES`).

### 9.4. Изменить базу данных
База уже создана, поэтому изменения делайте **отдельным скриптом-миграцией**, а не правкой старых:
1. Создайте `database/07_<что_делаем>.sql`, например:
   ```sql
   USE KrakenShop;
   GO
   SET ANSI_NULLS ON;
   SET QUOTED_IDENTIFIER ON;
   GO
   IF COL_LENGTH('dbo.Listings', 'Server') IS NULL
       ALTER TABLE dbo.Listings ADD Server NVARCHAR(50) NULL;   -- сервер игры для лота
   GO
   ```
2. Выполните его в SSMS (F5). Перенесите это же изменение в `02_schema.sql` (чтобы новая база создавалась сразу правильной) и добавьте `'07_...sql'` в список `SCRIPTS` в `scripts/db-init.js` — тогда CI проверит его.
3. Обновите запросы в `server/mssqlRepo.js` **и** ту же логику в `server/memoryRepo.js` (иначе тесты разойдутся с базой).
4. Обновите ER-диаграмму: `docs/database/er-diagram.mmd` (её можно вставить в draw.io: *Arrange → Insert → Advanced → Mermaid*) или перерисуйте в SSMS.

Добавить игру или раздел — достаточно SQL в SSMS:
```sql
INSERT INTO dbo.Games (Name, Slug, Section, Description, SortOrder)
VALUES (N'Minecraft', 'minecraft', 'game', N'Accounts and servers', 17);
INSERT INTO dbo.Categories (GameId, Name, Slug, Kind)
SELECT GameId, N'Accounts', 'accounts', 'account' FROM dbo.Games WHERE Slug = 'minecraft';
```
Игра сразу появится в левом меню. Чтобы она была и в демо-режиме — допишите её в `GAMES` в `server/memoryRepo.js` и в `04_seed.sql`.

Добавить новость — `INSERT INTO dbo.News (AuthorId, Title, Body) VALUES (5, N'Заголовок', N'Текст');`.

### 9.5. Изменить внешний вид
- Цвета и шрифты — переменные в начале `public/css/style.css` (`--panel`, `--frame`, `--red`, `--head` ...).
- Логотип — `public/img/kraken-mark.svg`, промо-картинка на главной — `public/img/promo-kraken.svg`, иконки лотов без картинки — `public/img/kinds/*.svg`.
- Тексты страниц About/FAQ/Rules — объект `TEXT_PAGES` в `server/views.js`.

### 9.6. Добавить действие через API
1. Маршрут в `server/app.js` внутри `api` (например, `api.post('/favorites', requireAuth, async (req, res) => {...})`). Всегда: `requireAuth`, проверка входных данных, проверка, что объект принадлежит пользователю.
2. Метод в обоих репозиториях (`mssqlRepo.js`, `memoryRepo.js`).
3. Вызов из браузера в `public/js/...` через `api('/favorites', { method: 'POST', body: {...} })` из `common.js`.
4. Тест в `tests/helpers.js` (`apiContract` — запускается и на памяти, и на SQL Server).

---

## 10. Безопасность: что уже сделано и правила

| Угроза | Где закрыто | Как |
|---|---|---|
| SQL-инъекции | `server/mssqlRepo.js` | только параметры `@name` (`req.input`), никакой склейки строк с вводом пользователя |
| XSS | `server/html.js`, `public/js/chat.js` | шаблон `html\`\`` экранирует всё; в чате текст выводится через `textContent`; CSP `script-src 'self'` (нет inline-скриптов); картинки только PNG/JPEG/WEBP/GIF (SVG запрещён) |
| CSRF | `server/app.js` | cookie `SameSite=Lax` + проверка заголовка `Origin` для POST/PUT/DELETE в API |
| Пароли | `server/auth.js` | scrypt с солью; Special code тоже хранится только хешем |
| Сессии | `server/auth.js`, `app.js` | случайный токен в HttpOnly-cookie, в БД — только его SHA-256, срок 7 дней |
| Чужие данные (IDOR) | `loadConversationFor`, `loadOrderFor` | чат и сделку видят только покупатель и продавец; лот меняет только владелец |
| Деньги | `database/03_procedures.sql` | транзакции + блокировки `UPDLOCK, HOLDLOCK`; `CHECK (Balance >= 0)`; запрещена покупка своего лота |
| Открытые редиректы | `safeNext`, обработчик `.html` | `?next=` принимает только локальные пути |
| Заголовки | `app.js` | CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| Права БД | `06_app_login.sql` | сайт работает под `kraken_app`: только чтение/запись данных и запуск процедур, без права менять таблицы |
| Секреты | `.gitignore`, `.dockerignore`, `.env` | пароли только в `.env` и GitHub Secrets; в образ не попадают |
| Docker | `Dockerfile` | процесс не от root, только production-зависимости |

Не сделано (можно указать в отчёте как развитие): ограничение числа попыток входа, настоящая платёжная система, панель модератора для споров и «Call support».

**Правила для нового кода:** HTML только через `html\`\``; SQL только с параметрами; каждое действие проверяет, чей это объект; секреты только в `.env`.

---

## 11. SEO и замер Lighthouse

- У каждой страницы свой `<title>`, `description`, `canonical`, Open Graph; один `<h1>`.
- Публичные страницы собираются на сервере — поисковик сразу получает готовый HTML.
- `robots.txt` закрывает `/account`, `/deals`, `/chat`, `/sell`, `/login`, `/register`, `/search`, `/api/`; на этих страницах ещё и `noindex`.
- `sitemap.xml` строится из базы: страницы, игры, сервисы, лоты, продавцы. Адрес сайта берётся из `SITE_URL` в `.env`.
- Ответы API — заголовок `X-Robots-Tag: noindex, nofollow`.

**Замер:** запустите сайт в Docker → Chrome **в режиме инкогнито** → http://localhost:3000 → F12 → **Lighthouse** → Mode *Navigation*, Device *Desktop*, категория *SEO* → **Analyze page load** → скриншот в `docs/seo/after.png`. Мой замер: Performance / Accessibility / Best Practices / SEO = **100 / 100 / 100 / 100**. Подробно — `docs/seo/README.md`.

---

## 12. Что положить в отчёты

**61–63 (БД и начало разработки)**
- ER-диаграмма (`docs/database/er-diagram.png` и/или диаграмма из SSMS) + описание таблиц и связей (`docs/database/README.md`);
- скриншоты из SSMS: список таблиц, Design 2–3 таблиц, Select Top 1000 Rows, результаты `05_queries.sql`;
- скриншоты сайта: `docs/ui/01…11` (или свои);
- скриншоты кода: `database/02_schema.sql`, `03_procedures.sql`, `server/app.js`, `server/mssqlRepo.js`;
- ссылка на репозиторий.

**64–66 (Docker + GitHub Actions)**
- `Dockerfile`, `.dockerignore`; вывод `docker build`; контейнер и образ в Docker Desktop; сайт из контейнера на localhost:3000;
- вкладка Actions с зелёными `test`, `db-test`, `build`; шаги одной job; Packages с образом; Secrets and variables;
- Pull Request (`docs/pull-requests.md`); ссылка на публичный репозиторий.

**70–71 (SEO)**
- `docs/seo/before.png`, `docs/seo/after.png`, `docs/seo/README.md`, ссылка на Pull Request.

---

## 13. Частые ошибки

| Симптом | Что делать |
|---|---|
| `Database (mssql) is NOT reachable: Failed to connect to localhost:1433` | не включён TCP/IP или порт 1433 (раздел 4.3), не перезапущена служба |
| `Login failed for user 'kraken_app'` | не включён смешанный режим (4.2), не выполнен `06_app_login.sql` или неверный пароль в `.env` |
| `self-signed certificate` | в `.env` `DB_TRUST_CERT=true`; в SSMS — галочка *Trust server certificate* |
| `The EXECUTE permission was denied` | выполните `06_app_login.sql` целиком (там `GRANT EXECUTE`) |
| Страница «Oops / Something went wrong» | база недоступна — смотрите сообщение в терминале сервера |
| Из Docker не подключается к SQL Server на компьютере | `DB_SERVER=host.docker.internal`; разрешите входящий TCP 1433 в брандмауэре (*Windows Defender Firewall → Advanced settings → Inbound Rules → New Rule → Port → TCP 1433*) |
| `docker compose ... db` сразу выключается | пароль `sa` слишком простой (нужно 8+ символов, 3 вида символов) |
| `npm test`: «Could not find 'tests/*.test.js'» | нужен Node.js 22+ (`node -v`) |
| `npm` не найден | Node.js не установлен или терминал открыт до установки — перезапустите VS Code |
| После входа снова «Log in» | открываете сайт по `http`, а в `.env` `COOKIE_SECURE=true` → поставьте `false` |
| Курсы валют не меняются | сайт ЦБ недоступен — показываются последние значения из таблицы `ExchangeRates`, это нормально |
| Job `build` в Actions — *skipped* | так и должно быть для Pull Request и не основных веток |
