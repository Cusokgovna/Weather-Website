# Weather — сайт погоды

![build](https://github.com/cusokgovna/weather-website/actions/workflows/build.yml/badge.svg)

Сайт прогноза погоды: текущая погода, прогноз на 24 часа с графиком, на 7 дней, индекс качества воздуха. Пользователи регистрируются, сохраняют избранные города, видят историю поиска; тема оформления хранится в профиле.

**Стек:** HTML/CSS/JS (фронтенд) · Node.js 22 + Express 5 (бэкенд, API) · **Microsoft SQL Server 2022** (база данных, SSMS) · Docker · GitHub Actions + GHCR.

📘 **Пошаговая инструкция (SSMS, VS Code / Visual Studio, Docker, GitHub): [docs/INSTRUCTIONS.md](docs/INSTRUCTIONS.md)**

## Быстрый старт

```bash
npm install
copy .env.example .env        # заполнить OPENWEATHER_KEY и DB_* (см. инструкцию)
# создать базу: выполнить database/01..03 в SSMS или
npm run db:init
npm start                     # http://localhost:3000
```

Всё в Docker (сайт + SQL Server в контейнере, нужен только `DB_PASSWORD` и `OPENWEATHER_KEY` в `.env`):

```bash
docker compose -f docker-compose.yml -f docker-compose.db.yml up --build
```

Демо-пользователь из `03_seed.sql`: `demo@example.com` / `demo1234`.

## Архитектура

```
Браузер ──► Express (server/app.js)
              ├─ /           статические страницы из public/  (/, /faq, /profile, robots.txt, sitemap.xml)
              ├─ /api/auth   регистрация, вход, выход (сессия в HttpOnly cookie)
              ├─ /api/users  профиль, аватар, настройки
              ├─ /api/favorites, /api/history
              └─ /api/ow     прокси к OpenWeather — ключ хранится только на сервере
                       │
                       ▼
              Microsoft SQL Server — база WeatherDb (server/mssqlRepo.js, параметризованные запросы)
```

| Папка / файл | Содержимое |
|---|---|
| `public/` | фронтенд |
| `server/` | бэкенд: `app.js` (маршруты), `mssqlRepo.js` (SQL), `memoryRepo.js` (для тестов), `auth.js` (scrypt, сессии) |
| `database/` | SQL-скрипты: создание БД, таблицы, тестовые данные, запросы, логин приложения |
| `tests/` | автотесты (`npm test`) |
| `docs/database/` | ER-диаграмма и описание таблиц |
| `docs/seo/` | замеры Lighthouse до/после, описание SEO-работ |
| `docs/pull-requests.md` | работа с Pull Request |
| `Dockerfile`, `.dockerignore`, `docker-compose*.yml` | контейнеризация |
| `.github/workflows/build.yml` | CI: тесты → тесты на SQL Server → сборка и публикация образа в GHCR |

## API

| Метод и путь | Описание |
|---|---|
| `GET /api/health` | состояние сервера и подключения к БД |
| `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` | аккаунт |
| `PUT /api/users/me` · `PUT /api/users/me/avatar` | имя/email, аватар |
| `GET/PUT /api/users/me/settings` | тема, единицы, язык |
| `GET/POST /api/favorites` · `DELETE /api/favorites/:cityId` | избранные города |
| `GET/POST /api/history` | история поиска |
| `GET /api/ow?path=/data/2.5/weather&lat=..&lon=..` | прокси OpenWeather (разрешённые пути: geo direct/reverse, weather, forecast, air_pollution) |

Все ответы `/api/*` содержат заголовок `X-Robots-Tag: noindex, nofollow`.

## Безопасность

- Секреты (ключ OpenWeather, пароль БД) — только в `.env` (в `.gitignore` и `.dockerignore`) и в GitHub Secrets.
- Пароли хранятся как хеш scrypt с солью; в БД сессий — только SHA-256 от токена.
- Все SQL-запросы параметризованы; у приложения отдельный логин с правами `db_datareader` + `db_datawriter`.

---

Made by Zhanakhmet Abdulaziz and Tauken Ruslan.
