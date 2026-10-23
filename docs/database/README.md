# База данных KrakenShop (Microsoft SQL Server)

Реляционная база биржи игровых ценностей. СУБД — **Microsoft SQL Server 2022** (Express / Developer или контейнер Docker), управление — **SQL Server Management Studio (SSMS)**.

## ER-диаграмма

![ER-диаграмма](er-diagram.png)

Исходник — [`er-diagram.mmd`](er-diagram.mmd) (Mermaid: GitHub рисует его сам; в draw.io — *Arrange → Insert → Advanced → Mermaid*), векторная версия — [`er-diagram.svg`](er-diagram.svg).
В Mermaid нельзя писать запятую в типе, поэтому `DECIMAL(12_2)` означает `DECIMAL(12,2)`.

## Таблицы (12)

| Таблица | Назначение | Ключи и связи |
|---|---|---|
| `Users` | Пользователи: Nickname, email, хеш пароля (scrypt), хеш Special code, Real name, аватар, баланс | PK `UserId`; UNIQUE `Username`, `Email`; CHECK `Balance >= 0` |
| `Sessions` | Сессии входа (в cookie токен, в БД — только SHA-256) | FK `UserId` → Users (CASCADE), **1 : N** |
| `Games` | Игры и сервисы из левого меню (`Section` = game / service) | PK `GameId`; UNIQUE `Name`, `Slug` |
| `Categories` | Разделы игры: предметы, валюта, аккаунты, услуги, подарочные карты, приложения | FK `GameId` → Games (CASCADE), **1 : N**; UNIQUE (`GameId`, `Slug`) |
| `Listings` | Лоты (offers): цена, количество, картинка, статус | FK `SellerId` → Users, FK `CategoryId` → Categories |
| `Conversations` | Чат покупателя с продавцом по лоту («TO CHAT», «CALL SUPPORT») | FK → Listings, Users (покупатель и продавец); UNIQUE (`ListingId`, `BuyerId`) |
| `Messages` | Сообщения чата, картинки, системные сообщения (`SenderId` = NULL) | FK `ConversationId` → Conversations, **1 : N** |
| `Orders` | Сделки; `TotalPrice` — вычисляемый столбец | FK → Listings, Conversations, Users (покупатель и продавец); CHECK покупатель ≠ продавец |
| `Transactions` | Движение денег: пополнение, покупка, продажа, возврат + баланс после операции | FK → Users, Orders (NULL для пополнения) |
| `Reviews` | Отзыв покупателя (1–5 ☆) | FK → Orders (UNIQUE: **1 : 0..1**), Users |
| `News` | Новости сайта | FK `AuthorId` → Users |
| `ExchangeRates` | Курсы EUR / USD для полосы «Exchange rate» | PK `CurrencyCode` |

**Связи многие-ко-многим** реализованы через промежуточные таблицы: пользователи ↔ лоты через `Orders` (покупки) и через `Conversations` (чаты).
**Самосвязь пользователей** — в `Orders` и `Conversations` два внешних ключа на `Users` (покупатель и продавец).

**Представление** `vw_SellerStats` — статистика для страницы «Account information»: продажи, сделки, отзывы, средний рейтинг, активные лоты и **Social credit** = 10 × завершённые сделки + 20 × (сумма звёзд сверх 3) − 100 × сделки продавца со спором или возвратом.

**Хранимые процедуры** (`03_procedures.sql`) — все операции с деньгами выполняются в одной транзакции с блокировками `UPDLOCK, HOLDLOCK`:

| Процедура | Что делает | Ошибки |
|---|---|---|
| `usp_CreateOrder` | списывает деньги покупателя (заморозка), уменьшает количество в лоте, создаёт сделку, запись в кошельке и системное сообщение в чате | 50001 лот недоступен, 50002 свой лот, 50003 нет количества, 50004 мало денег |
| `usp_CompleteOrder` | покупатель подтвердил получение → деньги продавцу | 50005, 50006 |
| `usp_RefundOrder` | продавец вернул деньги → товар снова в продаже | 50005, 50006 |
| `usp_Deposit` | пополнение баланса (учебное, без платёжной системы) | 50007 |
| `usp_GetOrCreateConversation` | найти или создать чат по лоту | 50001, 50002 |

Каскадное удаление включено только для `Sessions` и `Categories`: сделки и деньги нельзя удалять вместе с пользователем, а SQL Server запрещает несколько каскадных путей к одной таблице.

## Скрипты (папка `database/`)

| Файл | Что делает |
|---|---|
| `01_create_database.sql` | создаёт базу `KrakenShop` |
| `02_schema.sql` | 12 таблиц, ключи, ограничения, индексы, представление |
| `03_procedures.sql` | хранимые процедуры |
| `04_seed.sql` | тестовые данные: 16 игр + 2 сервиса, 48 разделов, 5 пользователей, 18 лотов, 4 чата, 3 сделки, отзыв, 3 новости, курсы |
| `05_queries.sql` | запросы для проверки и отчёта (JOIN, GROUP BY, представление, проверка целостности кошелька) |
| `06_app_login.sql` | логин `kraken_app`: чтение и запись данных + запуск процедур, без права менять структуру |

Все скрипты идемпотентные. Порядок: 01 → 02 → 03 → 04 → 06. Скрипты 01–04 также выполняет `npm run db:init` и job `db-test` в GitHub Actions.
Пошаговая инструкция — [`docs/INSTRUCTIONS.md`](../INSTRUCTIONS.md), раздел 4.
